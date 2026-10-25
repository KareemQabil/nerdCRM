package com.ioeti.core.policy;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.ioeti.core.api.ApiException;
import com.ioeti.core.policy.PolicyDefinition.Field;
import com.ioeti.core.policy.PolicyDefinition.Scope;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.format.DateTimeParseException;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.regex.Pattern;

/** Checks a policy value and its scope against the definition, and returns the value in its stored form. */
public final class PolicyValidator {

  static final ObjectMapper JSON = new ObjectMapper();
  private static final JsonNodeFactory NODES = JsonNodeFactory.instance;
  private static final Pattern CODE = Pattern.compile("[A-Za-z0-9][A-Za-z0-9 _.:/+-]{0,59}");
  private static final Pattern ID = Pattern.compile("[1-9][0-9]{0,17}");

  private PolicyValidator() {}

  /** The stored scope key: null for a company-wide or default value. */
  public static String scope(PolicyDefinition definition, String raw) {
    String scope = raw == null || raw.isBlank() ? null : raw.strip();
    if (scope == null) {
      if (definition.scope() == Scope.NONE || definition.allowsDefault()) return null;
      throw ApiException.invalidField("scope", "REQUIRED", "Choose what this policy applies to.");
    }
    boolean ok = switch (definition.scope()) {
      case NONE -> false;
      case COURSE, CLIENT_AGREEMENT -> ID.matcher(scope).matches();
      case DATA_TYPE -> PolicyCatalog.DATA_TYPES.contains(scope);
      default -> CODE.matcher(scope).matches();
    };
    if (!ok) throw ApiException.invalidField("scope", "UNAVAILABLE", "This policy cannot be set for that.");
    return scope;
  }

  /** The value checked field by field, then by the policy's own rules; unknown fields are dropped. */
  public static ObjectNode value(PolicyDefinition definition, JsonNode raw) {
    if (raw == null || !raw.isObject()) throw ApiException.invalidField("value", "REQUIRED", "A value is required.");
    ObjectNode out = fields(definition.fields(), raw, "value");
    rules(definition.key(), out);
    return out;
  }

  private static ObjectNode fields(List<Field> fields, JsonNode raw, String path) {
    ObjectNode out = NODES.objectNode();
    for (Field field : fields) {
      JsonNode v = raw.get(field.name());
      String at = path + "." + field.name();
      boolean empty = v == null || v.isNull() || (v.isTextual() && v.asText().isBlank()) || (v.isArray() && v.isEmpty());
      if (empty) {
        if (field.required()) throw ApiException.invalidField(at, "REQUIRED", "This field is required.");
        continue;
      }
      out.set(field.name(), one(field, v, at));
    }
    return out;
  }

  private static JsonNode one(Field field, JsonNode v, String at) {
    switch (field.kind()) {
      case PERCENT, DECIMAL -> {
        BigDecimal n = number(v, at);
        if (n.scale() > 2 && n.stripTrailingZeros().scale() > 2) throw ApiException.invalidField(at, "FORMAT", "Use at most two decimals.");
        BigDecimal low = field.kind() == PolicyDefinition.Kind.PERCENT ? BigDecimal.ZERO : field.min() == null ? null : BigDecimal.valueOf(field.min());
        BigDecimal high = field.kind() == PolicyDefinition.Kind.PERCENT ? BigDecimal.valueOf(100) : field.max() == null ? null : BigDecimal.valueOf(field.max());
        if ((low != null && n.compareTo(low) < 0) || (high != null && n.compareTo(high) > 0)) {
          throw ApiException.invalidField(at, "RANGE", "This value is out of range.");
        }
        return NODES.numberNode(n.stripTrailingZeros().scale() < 0 ? n.setScale(0) : n.stripTrailingZeros());
      }
      case INTEGER -> {
        BigDecimal n = number(v, at);
        if (n.stripTrailingZeros().scale() > 0) throw ApiException.invalidField(at, "FORMAT", "Use a whole number.");
        long whole = n.longValueExact();
        if ((field.min() != null && whole < field.min()) || (field.max() != null && whole > field.max())) {
          throw ApiException.invalidField(at, "RANGE", "This value is out of range.");
        }
        return NODES.numberNode(whole);
      }
      case BOOLEAN -> {
        if (!v.isBoolean()) throw ApiException.invalidField(at, "FORMAT", "Use yes or no.");
        return v;
      }
      case CHOICE -> {
        if (!v.isTextual() || !field.options().contains(v.asText())) throw ApiException.invalidField(at, "UNAVAILABLE", "Choose one of the options.");
        return v;
      }
      case MULTI_CHOICE -> {
        if (!v.isArray()) throw ApiException.invalidField(at, "FORMAT", "Choose from the options.");
        Set<String> seen = new HashSet<>();
        ArrayNode list = NODES.arrayNode();
        for (JsonNode item : v) {
          if (!item.isTextual() || !field.options().contains(item.asText())) throw ApiException.invalidField(at, "UNAVAILABLE", "Choose from the options.");
          if (seen.add(item.asText())) list.add(item.asText());
        }
        return list;
      }
      case TEXT -> {
        String text = v.asText().strip();
        if (field.max() != null && text.length() > field.max()) throw ApiException.invalidField(at, "TOO_LONG", "This text is too long.");
        return NODES.textNode(text);
      }
      case TIME -> {
        try {
          return NODES.textNode(LocalTime.parse(v.asText().strip()).toString());
        } catch (DateTimeParseException e) {
          throw ApiException.invalidField(at, "FORMAT", "Use a time like 09:00.");
        }
      }
      case DATE_LIST -> {
        if (!v.isArray() || v.size() > 366) throw ApiException.invalidField(at, "FORMAT", "Use a list of dates.");
        java.util.TreeSet<LocalDate> dates = new java.util.TreeSet<>();
        for (JsonNode item : v) {
          try { dates.add(LocalDate.parse(item.asText().strip())); }
          catch (DateTimeParseException e) { throw ApiException.invalidField(at, "FORMAT", "Use dates like 2026-11-01."); }
        }
        ArrayNode list = NODES.arrayNode();
        dates.forEach(d -> list.add(d.toString()));
        return list;
      }
      case LIST -> {
        if (!v.isArray()) throw ApiException.invalidField(at, "FORMAT", "Use a list.");
        if (field.max() != null && v.size() > field.max()) throw ApiException.invalidField(at, "TOO_MANY", "The list is too long.");
        ArrayNode list = NODES.arrayNode();
        int i = 0;
        for (JsonNode item : v) {
          if (!item.isObject()) throw ApiException.invalidField(at + "[" + i + "]", "FORMAT", "Each item needs its fields.");
          list.add(fields(field.items(), item, at + "[" + i + "]"));
          i++;
        }
        return list;
      }
      default -> throw new IllegalStateException(field.kind().name());
    }
  }

  private static BigDecimal number(JsonNode v, String at) {
    try {
      if (v.isNumber()) return v.decimalValue();
      if (v.isTextual()) return new BigDecimal(v.asText().strip());
    } catch (NumberFormatException e) {
      // falls through
    }
    throw ApiException.invalidField(at, "FORMAT", "Use a number.");
  }

  /** Rules between fields of one policy. */
  private static void rules(String key, ObjectNode v) {
    switch (key) {
      case "sales.quote-approval" -> {
        BigDecimal previous = BigDecimal.valueOf(-1);
        for (JsonNode tier : v.withArray("tiers")) {
          BigDecimal discount = tier.get("maxDiscountPercent").decimalValue();
          if (discount.compareTo(previous) <= 0) {
            throw ApiException.invalidField("value.tiers", "ORDER", "List the tiers from the smallest discount to the largest.");
          }
          previous = discount;
        }
      }
      case "cert.decision" -> {
        if ("COMMITTEE".equals(v.path("mode").asText()) && !v.has("committeeSize")) {
          throw ApiException.invalidField("value.committeeSize", "REQUIRED", "A committee needs its number of members.");
        }
      }
      case "work.calendar" -> {
        if (!LocalTime.parse(v.get("end").asText()).isAfter(LocalTime.parse(v.get("start").asText()))) {
          throw ApiException.invalidField("value.end", "BEFORE_START", "The day must end after it starts.");
        }
      }
      case "recruitment.agreement" -> {
        if ("PARTIAL_REFUND".equals(v.path("replacement").asText()) && !v.has("refundPercent")) {
          throw ApiException.invalidField("value.refundPercent", "REQUIRED", "A partial refund needs its percentage.");
        }
      }
      case "finance.fx" -> {
        for (String code : v.get("currencies").asText().split(",")) {
          if (!code.strip().matches("[A-Z]{3}")) throw ApiException.invalidField("value.currencies", "FORMAT", "Use currency codes like USD,EUR.");
        }
      }
      default -> { }
    }
  }

  static String write(JsonNode value) {
    try {
      return JSON.writeValueAsString(value);
    } catch (com.fasterxml.jackson.core.JsonProcessingException e) {
      throw new IllegalStateException(e);
    }
  }

  public static JsonNode read(String json) {
    try {
      return json == null ? null : JSON.readTree(json);
    } catch (com.fasterxml.jackson.core.JsonProcessingException e) {
      throw new IllegalStateException(e);
    }
  }
}
