package com.ioeti.workspace.service;

import com.axelor.app.AppSettings;
import com.axelor.apps.base.db.Company;
import com.axelor.apps.base.db.Currency;
import com.axelor.apps.base.db.CurrencyConversionLine;
import com.axelor.apps.base.db.repo.CompanyRepository;
import com.axelor.apps.base.service.app.AppBaseService;
import com.axelor.auth.db.User;
import com.axelor.db.JPA;
import com.axelor.db.Query;
import com.axelor.studio.db.AppBase;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.google.inject.Inject;
import com.google.inject.persist.Transactional;
import com.ioeti.core.api.ApiException;
import com.ioeti.core.db.PolicyVersion;
import com.ioeti.core.policy.PolicyService;
import com.ioeti.workspace.db.FxRate;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Optional;
import java.util.Set;

/**
 * D-06 (signed 2026-10-25): amounts in other currencies are converted to the company currency (EGP) with
 * rates from the public source the owners chose in the {@code finance.fx} policy, which finance can always
 * override by hand. Nothing converts without the policy, and a rate older than the policy allows is refused
 * ({@code FX_STALE}) rather than used. The rate in use is mirrored as a native AOS conversion line.
 */
public class FxService {

  public static final String KEY = "finance.fx";
  public static final String PUBLIC_API = "PUBLIC_API";
  public static final String MANUAL = "MANUAL";
  /** The public source; the URL can be pointed elsewhere (tests, a mirror) with {@code ioeti.fx.url}. */
  static final String DEFAULT_URL = "https://open.er-api.com/v6/latest/";
  static final BigDecimal MAX_RATE = new BigDecimal("1000000000");

  private final PolicyService policies;
  private final AppBaseService appBaseService;
  private final CompanyRepository companies;

  @Inject
  public FxService(PolicyService policies, AppBaseService appBaseService, CompanyRepository companies) {
    this.policies = policies;
    this.appBaseService = appBaseService;
    this.companies = companies;
  }

  /** The finance.fx policy in force: where rates come from, which currencies, and how old a rate may be. */
  public record Settings(Long versionId, String source, List<String> currencies, int maxAgeHours) {}

  /** A rate in use for a currency, with its age against the policy. */
  public record Quote(Currency currency, FxRate rate, boolean stale) {}

  public Optional<Settings> settings(LocalDate on) {
    return policies.current(KEY, null, on).map(a -> new Settings(a.versionId(), a.value().path("source").asText(),
        currencies(a.value().path("currencies").asText("")), a.value().path("maxAgeHours").asInt()));
  }

  public Settings requireSettings(LocalDate on) {
    PolicyService.Applied a = policies.require(KEY, null, on);
    return settings(on).filter(s -> s.versionId().equals(a.versionId())).orElseThrow();
  }

  static List<String> currencies(String raw) {
    Set<String> out = new LinkedHashSet<>();
    for (String c : raw.split(",")) if (!c.isBlank()) out.add(c.strip().toUpperCase());
    return List.copyOf(out);
  }

  /** The company currency every amount is converted to (EGP for IOETI). */
  public Currency baseCurrency() {
    Company company = companies.all().order("id").fetchOne();
    if (company == null || company.getCurrency() == null) {
      throw new ApiException(422, "SETUP_REQUIRED", "No company currency is configured.", null);
    }
    return company.getCurrency();
  }

  /** The rate in use for a currency on a date: the newest date on or before it, a manual rate winning on its date. */
  public Optional<FxRate> rate(Currency currency, LocalDate on) {
    FxRate newest = Query.of(FxRate.class).filter("self.currency = ?1 AND self.rateDate <= ?2", currency, on).order("-rateDate").fetchOne();
    if (newest == null) return Optional.empty();
    return Query.of(FxRate.class).filter("self.currency = ?1 AND self.rateDate = ?2", currency, newest.getRateDate()).fetch(200).stream()
        .min(Comparator.comparing((FxRate r) -> MANUAL.equals(r.getSource()) ? 0 : 1)
            .thenComparing(FxRate::getRecordedAt, Comparator.reverseOrder())
            .thenComparing(FxRate::getId, Comparator.reverseOrder()));
  }

  /** The rate in use and whether it is older than the policy allows; empty when there is none. */
  public Optional<Quote> quote(Currency currency, Settings settings, LocalDateTime now) {
    return rate(currency, now.toLocalDate()).map(r -> new Quote(currency, r, r.getAsOf().plusHours(settings.maxAgeHours()).isBefore(now)));
  }

  /** Fetches today's rates for the policy's currencies from the public source. Refused when the policy says manual only. */
  @Transactional(rollbackOn = {Exception.class})
  public List<FxRate> refresh(User me, LocalDateTime now) {
    Settings settings = requireSettings(now.toLocalDate());
    if (!PUBLIC_API.equals(settings.source())) {
      throw new ApiException(422, "FX_MANUAL_ONLY", "The finance.fx policy says rates are entered by hand.", null);
    }
    Currency base = baseCurrency();
    String url = AppSettings.get().get("ioeti.fx.url", DEFAULT_URL) + base.getCodeISO();
    JsonNode body = fetch(url);
    if (!"success".equals(body.path("result").asText()) || !body.path("rates").isObject()) {
      throw new ApiException(502, "FX_SOURCE_UNAVAILABLE", "The exchange-rate source did not answer with rates; enter the rate by hand.", null);
    }
    LocalDateTime asOf = LocalDateTime.ofInstant(Instant.ofEpochSecond(body.path("time_last_update_unix").asLong(0)), ZoneId.systemDefault());
    if (asOf.getYear() < 2000 || asOf.isAfter(now.plusHours(1))) {
      throw new ApiException(502, "FX_SOURCE_UNAVAILABLE", "The exchange-rate source gave no usable date; enter the rate by hand.", null);
    }
    String provider = URI.create(url).getHost();
    List<FxRate> recorded = new ArrayList<>();
    for (String code : settings.currencies()) {
      Currency currency = currency(code);
      JsonNode perBase = body.path("rates").path(code);
      if (currency == null || currency.equals(base) || !perBase.isNumber() || perBase.decimalValue().signum() <= 0) continue;
      // the source gives how much of the currency one EGP buys; the rate kept is EGP per one unit of the currency
      BigDecimal rate = BigDecimal.ONE.divide(perBase.decimalValue(), 6, RoundingMode.HALF_UP);
      boolean known = Query.of(FxRate.class).filter("self.currency = ?1 AND self.source = ?2 AND self.asOf = ?3", currency, PUBLIC_API, asOf).count() > 0;
      if (known || rate.signum() <= 0) continue;
      recorded.add(append(currency, base, rate, asOf.toLocalDate(), asOf, PUBLIC_API, provider, null, me, settings, now));
    }
    return recorded;
  }

  /** Called on a schedule: fetches only when the policy names the public source and the newest fetched rate is half a day old. */
  @Transactional(rollbackOn = {Exception.class})
  public void refreshIfDue(LocalDateTime now) {
    Optional<Settings> settings = settings(now.toLocalDate());
    if (settings.isEmpty() || !PUBLIC_API.equals(settings.get().source())) return;
    FxRate newest = Query.of(FxRate.class).filter("self.source = ?1", PUBLIC_API).order("-asOf").fetchOne();
    if (newest != null && newest.getAsOf().isAfter(now.minusHours(12))) return;
    refresh(null, now);
  }

  /** Finance enters a rate by hand, with the reason; for its date it takes precedence over a fetched rate. */
  @Transactional(rollbackOn = {Exception.class})
  public FxRate override(String code, BigDecimal rate, LocalDate rateDate, String reason, User me, LocalDateTime now) {
    Settings settings = requireSettings(now.toLocalDate());
    Currency base = baseCurrency();
    String c = code == null ? "" : code.strip().toUpperCase();
    Currency currency = currency(c);
    if (currency == null || currency.equals(base) || !settings.currencies().contains(c)) {
      throw ApiException.invalidField("currency", "UNAVAILABLE", "Choose one of the currencies the finance.fx policy lists.");
    }
    if (rate == null || rate.signum() <= 0 || rate.compareTo(MAX_RATE) > 0 || rate.stripTrailingZeros().scale() > 6) {
      throw ApiException.invalidField("rate", "RANGE", "The rate must be above 0 with up to 6 decimals.");
    }
    LocalDate today = now.toLocalDate();
    LocalDate date = rateDate == null ? today : rateDate;
    if (date.isAfter(today) || date.isBefore(today.minusDays(366))) {
      throw ApiException.invalidField("rateDate", "RANGE", "The rate date must be within the last year and not in the future.");
    }
    String why = reason == null ? "" : reason.strip();
    if (why.isEmpty()) throw ApiException.invalidField("reason", "REQUIRED", "Say why the rate is entered by hand.");
    if (why.length() > 500) throw ApiException.invalidField("reason", "TOO_LONG", "Keep the reason under 500 characters.");
    return append(currency, base, rate, date, date.atStartOfDay(), MANUAL, null, why, me, settings, now);
  }

  public List<FxRate> history(int limit) {
    return Query.of(FxRate.class).order("-recordedAt").order("-id").fetch(limit);
  }

  private FxRate append(Currency currency, Currency base, BigDecimal rate, LocalDate date, LocalDateTime asOf, String source,
      String provider, String reason, User me, Settings settings, LocalDateTime now) {
    FxRate row = new FxRate();
    row.setCurrency(currency);
    row.setToCurrency(base);
    row.setRate(rate);
    row.setRateDate(date);
    row.setAsOf(asOf);
    row.setSource(source);
    row.setProvider(provider);
    row.setReason(reason);
    row.setEnteredBy(me);
    row.setRecordedAt(now);
    row.setPolicyVersion(JPA.find(PolicyVersion.class, settings.versionId()));
    row = JPA.save(row);
    JPA.flush();
    mirror(currency, base, date);
    return row;
  }

  /**
   * Keeps the native conversion lines of one currency pair in step with the rates in use: one line per rate
   * date, each running to the day before the next, so the native currency service finds exactly one.
   */
  private void mirror(Currency currency, Currency base, LocalDate date) {
    AppBase app = appBaseService.getAppBase();
    FxRate inUse = rate(currency, date).orElseThrow();
    List<CurrencyConversionLine> lines = new ArrayList<>(Query.of(CurrencyConversionLine.class)
        .filter("self.appBase = ?1 AND self.startCurrency = ?2 AND self.endCurrency = ?3", app, currency, base).fetch(5000));
    CurrencyConversionLine line = lines.stream().filter(l -> date.equals(l.getFromDate())).findFirst().orElse(null);
    if (line == null) {
      line = new CurrencyConversionLine();
      line.setStartCurrency(currency);
      line.setEndCurrency(base);
      line.setFromDate(date);
      app.addCurrencyConversionLineListItem(line);
      lines.add(line);
    }
    line.setExchangeRate(inUse.getRate());
    line.setVariations(inUse.getSource());
    lines.sort(Comparator.comparing(CurrencyConversionLine::getFromDate));
    for (int i = 0; i < lines.size(); i++) {
      lines.get(i).setToDate(i + 1 < lines.size() ? lines.get(i + 1).getFromDate().minusDays(1) : null);
      JPA.save(lines.get(i));
    }
  }

  private static Currency currency(String code) {
    return code == null || code.isBlank() ? null : Query.of(Currency.class).filter("self.codeISO = ?1", code).fetchOne();
  }

  private static JsonNode fetch(String url) {
    try {
      HttpClient client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).followRedirects(HttpClient.Redirect.NORMAL).build();
      HttpResponse<String> response = client.send(HttpRequest.newBuilder(URI.create(url)).timeout(Duration.ofSeconds(15))
          .header("Accept", "application/json").GET().build(), HttpResponse.BodyHandlers.ofString());
      if (response.statusCode() != 200) throw new IllegalStateException("HTTP " + response.statusCode());
      return new ObjectMapper().readTree(response.body());
    } catch (InterruptedException e) {
      Thread.currentThread().interrupt();
      throw new ApiException(502, "FX_SOURCE_UNAVAILABLE", "The exchange-rate source could not be reached; enter the rate by hand.", null);
    } catch (Exception e) {
      throw new ApiException(502, "FX_SOURCE_UNAVAILABLE", "The exchange-rate source could not be reached; enter the rate by hand.", null);
    }
  }
}
