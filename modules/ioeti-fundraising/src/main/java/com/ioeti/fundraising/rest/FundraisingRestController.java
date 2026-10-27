package com.ioeti.fundraising.rest;

import com.axelor.apps.account.db.AnalyticAccount;
import com.axelor.apps.account.db.repo.AnalyticAccountRepository;
import com.axelor.apps.base.db.Currency;
import com.axelor.apps.base.db.Partner;
import com.axelor.apps.marketing.db.Campaign;
import com.axelor.auth.AuthUtils;
import com.axelor.auth.db.AuditableModel;
import com.axelor.auth.db.User;
import com.axelor.db.JPA;
import com.axelor.db.JpaSecurity;
import com.axelor.db.Model;
import com.axelor.db.Query;
import com.axelor.inject.Beans;
import com.axelor.rpc.filter.Filter;
import com.axelor.rpc.filter.JPQLFilter;
import com.axelor.utils.api.ConflictChecker;
import com.axelor.utils.api.ResponseConstructor;
import com.axelor.utils.api.SecurityCheck;
import com.ioeti.core.api.ApiException;
import com.ioeti.core.api.IoetiEndpoint;
import com.ioeti.core.api.RecordAccess;
import com.ioeti.core.web.OptimisticLockConflicts;
import com.ioeti.fundraising.db.DonationCollection;
import com.ioeti.fundraising.db.DonationReceipt;
import com.ioeti.fundraising.db.DonorProfile;
import com.ioeti.fundraising.db.DonorSensitiveProfile;
import com.ioeti.fundraising.db.FundRestriction;
import com.ioeti.fundraising.db.FundingCommitment;
import com.ioeti.fundraising.db.FundingOpportunity;
import com.ioeti.fundraising.db.GrantDeliverable;
import com.ioeti.fundraising.db.PledgeInstallment;
import com.ioeti.fundraising.db.StewardshipActivity;
import com.ioeti.fundraising.db.repo.DonationCollectionRepository;
import com.ioeti.fundraising.db.repo.DonationReceiptRepository;
import com.ioeti.fundraising.db.repo.DonorProfileRepository;
import com.ioeti.fundraising.db.repo.FundingOpportunityRepository;
import com.ioeti.fundraising.db.repo.GrantDeliverableRepository;
import com.ioeti.fundraising.db.repo.StewardshipActivityRepository;
import com.ioeti.fundraising.service.FundraisingService;
import io.swagger.v3.oas.annotations.Operation;
import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.PUT;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.PathParam;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.QueryParam;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import java.util.regex.Pattern;

/**
 * Fundraising and partnerships (Wave 4E). Every list goes through the caller's read permissions;
 * restricted donor data and bank references are accepted but never returned. D-05 (signed 2026-10-25): finance (native
 * rights on receipts and fund restrictions) issues donation receipts for recorded collections and maps restrictions to
 * native analytic accounts; restricted collections record their analytic account. Posting collections and invoicing
 * installments stay closed.
 */
@Path("/ioeti/fundraising")
@Produces(MediaType.APPLICATION_JSON)
public class FundraisingRestController {

  static final Pattern REFERENCE = Pattern.compile("[A-Z0-9][A-Z0-9-]{1,29}");
  static final BigDecimal MAX_AMOUNT = new BigDecimal("1000000000000");
  static final String[] STAGES = {"IDENTIFIED", "PROPOSAL", "SUBMITTED", "APPROVED", "DECLINED", "WITHDRAWN"};
  static final String[] KINDS = {"GRANT", "DONATION", "SPONSORSHIP"};
  static final String[] DONOR_TYPES = {"INDIVIDUAL", "FOUNDATION", "CORPORATE", "GOVERNMENT", "MULTILATERAL"};
  static final String[] ACTIVITIES = {"THANK_YOU", "IMPACT_REPORT", "MEETING", "VISIT", "CALL"};
  static final String[] VOID_REASONS = {"DUPLICATE_ENTRY", "WRONG_AMOUNT", "PAYMENT_RETURNED"};
  static final String[] RECEIPT_VOID_REASONS = {"WRONG_DONOR_DETAILS", "WRONG_AMOUNT", "COLLECTION_CORRECTED", "DUPLICATE"};
  static final Pattern RESTRICTION_CODE = Pattern.compile("[A-Z0-9][A-Z0-9-]{1,29}");
  static final Map<String, Integer> MOVABLE = Map.of(
      "PROPOSAL", FundingOpportunityRepository.STAGE_PROPOSAL, "SUBMITTED", FundingOpportunityRepository.STAGE_SUBMITTED,
      "DECLINED", FundingOpportunityRepository.STAGE_DECLINED, "WITHDRAWN", FundingOpportunityRepository.STAGE_WITHDRAWN);
  static final List<String> COLLECTION_STATUSES = List.of("DUE", "PARTIAL", "OVERDUE", "COLLECTED", "CANCELLED");
  static final String NOT_ARCHIVED = "(self.archived IS NULL OR self.archived = false)";

  // --- overview ------------------------------------------------------------------------------------

  @GET
  @Path("/overview")
  @Operation(summary = "Totals per currency and stage counts over the opportunities the caller may read", tags = {"IOETI fundraising"})
  @IoetiEndpoint
  public Response overview() {
    new SecurityCheck().readAccess(FundingOpportunity.class).check();
    List<FundingOpportunity> opportunities = readable(FundingOpportunity.class, new JPQLFilter(NOT_ARCHIVED)).fetch(2000);
    Map<String, Long> stages = new LinkedHashMap<>();
    for (String stage : STAGES) stages.put(stage, 0L);
    opportunities.forEach(o -> stages.merge(name(o.getStageSelect(), STAGES), 1L, Long::sum));
    LocalDate today = LocalDate.now();
    List<InstallmentStatusView> attention = installmentRows(null).stream()
        .filter(r -> r.status().equals("OVERDUE") || (r.status().matches("DUE|PARTIAL") && !r.dueDate().isAfter(today.plusDays(30))))
        .sorted(Comparator.comparing(InstallmentStatusView::dueDate)).limit(20).toList();
    return ResponseConstructor.build(Response.Status.OK, "Fundraising overview",
        new OverviewView(totals(opportunities), stages, attention, opportunities.size()));
  }

  @GET
  @Path("/collections")
  @Operation(summary = "Installments with their collection status (DUE, PARTIAL, OVERDUE, COLLECTED, CANCELLED)", tags = {"IOETI fundraising"})
  @IoetiEndpoint
  public Response collectionStatus(@QueryParam("status") String status) {
    if (status != null && !status.isBlank() && !COLLECTION_STATUSES.contains(status)) {
      throw ApiException.invalidField("status", "UNAVAILABLE", "Use DUE, PARTIAL, OVERDUE, COLLECTED or CANCELLED.");
    }
    new SecurityCheck().readAccess(PledgeInstallment.class).check();
    return ResponseConstructor.build(Response.Status.OK, "Collection status",
        installmentRows(status == null || status.isBlank() ? null : status));
  }

  @GET
  @Path("/campaigns")
  @Operation(summary = "Native marketing campaigns the caller may read, to attribute opportunities", tags = {"IOETI fundraising"})
  @IoetiEndpoint
  public Response campaigns() {
    new SecurityCheck().readAccess(Campaign.class).check();
    List<CampaignView> rows = readable(Campaign.class, null).order("name").fetch(200).stream()
        .map(c -> new CampaignView(c.getId(), c.getName())).toList();
    return ResponseConstructor.build(Response.Status.OK, "Campaigns", rows);
  }

  // --- donors --------------------------------------------------------------------------------------

  @GET
  @Path("/donors")
  @Operation(summary = "Donor profiles the caller may read; anonymous donors are named only to their manager", tags = {"IOETI fundraising"})
  @IoetiEndpoint
  public Response donors(@QueryParam("q") String q) {
    new SecurityCheck().readAccess(DonorProfile.class).check();
    String search = checkedText("q", q, 100, false);
    Filter where = search == null ? null : new JPQLFilter("LOWER(self.partner.name) LIKE ? AND (self.anonymous IS NULL OR self.anonymous = false OR self.relationshipManager = ?)",
        "%" + search.toLowerCase().replace("%", "").replace("_", "") + "%", AuthUtils.getUser());
    List<DonorView> rows = readable(DonorProfile.class, where).order("-id").fetch(200).stream()
        .map(FundraisingRestController::view).toList();
    return ResponseConstructor.build(Response.Status.OK, "Donors", rows);
  }

  @GET
  @Path("/donors/{id}")
  @Operation(summary = "One donor profile with totals per currency", tags = {"IOETI fundraising"})
  @IoetiEndpoint
  public Response donor(@PathParam("id") Long id) {
    DonorProfile donor = RecordAccess.readable(DonorProfile.class, id);
    List<FundingOpportunity> opportunities = readable(FundingOpportunity.class,
        new JPQLFilter("self.donor.id = ? AND " + NOT_ARCHIVED, donor.getId())).fetch(1000);
    return ResponseConstructor.build(Response.Status.OK, "Donor", new Donor360View(view(donor), totals(opportunities)));
  }

  @POST
  @Path("/donors")
  @Consumes(MediaType.APPLICATION_JSON)
  @Operation(summary = "Open a donor profile on an account; the caller manages the relationship", tags = {"IOETI fundraising"})
  @IoetiEndpoint
  public Response createDonor(CreateDonor command) {
    if (command == null) throw ApiException.badRequest("Donor details are required.");
    new SecurityCheck().createAccess(DonorProfile.class).check();
    Partner partner = command.partnerId() == null || command.partnerId() <= 0 ? null : JPA.find(Partner.class, command.partnerId());
    if (partner == null || !Beans.get(JpaSecurity.class).isPermitted(JpaSecurity.CAN_READ, Partner.class, partner.getId())) {
      throw ApiException.invalidField("partnerId", "UNAVAILABLE", "Choose an account you can see.");
    }
    Integer type = select("donorType", command.donorType(), DONOR_TYPES);
    if (Query.of(DonorProfile.class).filter("self.partner = ?1", partner).count() > 0) {
      throw new ApiException(409, "ALREADY_DONOR", "This account already has a donor profile.", null);
    }
    DonorProfile donor = new DonorProfile();
    donor.setPartner(partner);
    donor.setDonorTypeSelect(type);
    donor.setAnonymous(Boolean.TRUE.equals(command.anonymous()));
    donor.setRelationshipManager(AuthUtils.getUser());
    DonorProfile[] saved = new DonorProfile[1];
    write(() -> saved[0] = Beans.get(FundraisingService.class).create(donor));
    return ResponseConstructor.build(Response.Status.CREATED, "Donor profile opened", view(saved[0]));
  }

  @PUT
  @Path("/donors/{id}/sensitive")
  @Consumes(MediaType.APPLICATION_JSON)
  @Operation(summary = "Record giving capacity, contact preference and relationship note (write-only)", tags = {"IOETI fundraising"})
  @IoetiEndpoint
  public Response saveSensitive(@PathParam("id") Long id, SaveSensitive command) {
    DonorProfile donor = writable(DonorProfile.class, id, command == null ? null : command.version());
    new SecurityCheck().createAccess(DonorSensitiveProfile.class).writeAccess(DonorSensitiveProfile.class).check();
    DonorSensitiveProfile values = new DonorSensitiveProfile();
    values.setGivingCapacity(command.givingCapacity() == null ? null : amount("givingCapacity", command.givingCapacity()));
    values.setContactPreference(checkedText("contactPreference", command.contactPreference(), 255, false));
    values.setRelationshipNote(checkedText("relationshipNote", command.relationshipNote(), 4000, false));
    write(() -> Beans.get(FundraisingService.class).saveSensitive(donor, values));
    // the restricted values are never echoed back
    return ResponseConstructor.build(Response.Status.OK, "Sensitive profile recorded", view(donor));
  }

  @GET
  @Path("/donors/{id}/sensitive")
  @Operation(summary = "Read the donor's sensitive profile: blocked until D-05 and D-07", tags = {"IOETI fundraising"})
  @IoetiEndpoint
  public Response readSensitive(@PathParam("id") Long id) {
    RecordAccess.readable(DonorProfile.class, id);
    throw ApiException.policyBlocked("D-05 and D-07");
  }

  @GET
  @Path("/donors/{id}/timeline")
  @Operation(summary = "Stewardship and funding history of a donor, newest first", tags = {"IOETI fundraising"})
  @IoetiEndpoint
  public Response timeline(@PathParam("id") Long id) {
    DonorProfile donor = RecordAccess.readable(DonorProfile.class, id);
    List<DonorTimelineEvent> events = new ArrayList<>();
    readable(StewardshipActivity.class, new JPQLFilter("self.donor.id = ?", donor.getId())).fetch(500).forEach(s ->
        events.add(new DonorTimelineEvent(s.getOccurredOn().atStartOfDay(), name(s.getKindSelect(), ACTIVITIES), s.getSubject(), userName(s.getOwner()))));
    for (FundingOpportunity o : readable(FundingOpportunity.class, new JPQLFilter("self.donor.id = ?", donor.getId())).fetch(1000)) {
      events.add(new DonorTimelineEvent(o.getCreatedOn(), "OPPORTUNITY_OPENED", o.getReference(), userName(o.getCreatedBy())));
      if (Boolean.TRUE.equals(o.getArchived())) {
        events.add(new DonorTimelineEvent(o.getUpdatedOn(), "OPPORTUNITY_ARCHIVED", o.getReference(), userName(o.getUpdatedBy())));
      }
      FundingCommitment c = FundraisingService.commitment(o);
      if (c == null) continue;
      events.add(new DonorTimelineEvent(c.getApprovedOn().atStartOfDay(), "COMMITMENT_APPROVED", o.getReference(), userName(c.getCreatedBy())));
      for (DonationCollection k : readable(DonationCollection.class, new JPQLFilter("self.installment.commitment.id = ?", c.getId())).fetch(500)) {
        events.add(new DonorTimelineEvent(k.getReceivedOn().atStartOfDay(), "COLLECTION_RECORDED", o.getReference(), userName(k.getCreatedBy())));
        if (k.getVoidedAt() != null) events.add(new DonorTimelineEvent(k.getVoidedAt(), "COLLECTION_VOIDED", o.getReference(), userName(k.getVoidedBy())));
      }
      for (GrantDeliverable d : readable(GrantDeliverable.class, new JPQLFilter("self.commitment.id = ?", c.getId())).fetch(500)) {
        if (d.getSubmittedOn() != null) events.add(new DonorTimelineEvent(d.getSubmittedOn().atStartOfDay(), "DELIVERABLE_SUBMITTED", d.getTitle(), userName(d.getUpdatedBy())));
      }
    }
    events.removeIf(e -> e.at() == null);
    events.sort(Comparator.comparing(DonorTimelineEvent::at).reversed());
    return ResponseConstructor.build(Response.Status.OK, "Timeline", events);
  }

  @POST
  @Path("/donors/{id}/stewardship")
  @Consumes(MediaType.APPLICATION_JSON)
  @Operation(summary = "Record a stewardship activity (thank-you, impact report, meeting, visit, call)", tags = {"IOETI fundraising"})
  @IoetiEndpoint
  public Response steward(@PathParam("id") Long id, RecordActivity command) {
    DonorProfile donor = writable(DonorProfile.class, id, command == null ? null : command.version());
    new SecurityCheck().createAccess(StewardshipActivity.class).check();
    StewardshipActivity activity = new StewardshipActivity();
    activity.setDonor(donor);
    activity.setKindSelect(select("kind", command.kind(), ACTIVITIES));
    LocalDate on = requiredDate("occurredOn", command.occurredOn());
    if (on.isAfter(LocalDate.now())) throw ApiException.invalidField("occurredOn", "RANGE", "An activity cannot be dated in the future.");
    activity.setOccurredOn(on);
    activity.setSubject(checkedText("subject", command.subject(), 120, true));
    activity.setOwner(AuthUtils.getUser());
    write(() -> Beans.get(FundraisingService.class).create(activity));
    return ResponseConstructor.build(Response.Status.CREATED, "Activity recorded", view(donor));
  }

  // --- opportunities -------------------------------------------------------------------------------

  @GET
  @Path("/opportunities")
  @Operation(summary = "Grants, donations and sponsorships the caller may read, by stage, donor or campaign", tags = {"IOETI fundraising"})
  @IoetiEndpoint
  public Response opportunities(@QueryParam("stage") String stage, @QueryParam("donorId") Long donorId,
      @QueryParam("campaignId") Long campaignId, @QueryParam("q") String q) {
    new SecurityCheck().readAccess(FundingOpportunity.class).check();
    List<String> conditions = new ArrayList<>(List.of(NOT_ARCHIVED));
    List<Object> params = new ArrayList<>();
    if (stage != null && !stage.isBlank()) {
      conditions.add("self.stageSelect = ?");
      params.add(select("stage", stage, STAGES));
    }
    if (donorId != null) {
      conditions.add("self.donor.id = ?");
      params.add(donorId);
    }
    if (campaignId != null) {
      conditions.add("self.campaign.id = ?");
      params.add(campaignId);
    }
    String search = checkedText("q", q, 100, false);
    if (search != null) {
      conditions.add("(LOWER(self.reference) LIKE ? OR LOWER(self.title) LIKE ?)");
      String like = "%" + search.toLowerCase().replace("%", "").replace("_", "") + "%";
      params.add(like);
      params.add(like);
    }
    List<FundingOpportunityView> rows = readable(FundingOpportunity.class, new JPQLFilter(String.join(" AND ", conditions), params.toArray()))
        .order("-id").fetch(500).stream().map(FundraisingRestController::view).toList();
    return ResponseConstructor.build(Response.Status.OK, "Opportunities", rows);
  }

  @GET
  @Path("/opportunities/{id}")
  @Operation(summary = "One opportunity", tags = {"IOETI fundraising"})
  @IoetiEndpoint
  public Response opportunity(@PathParam("id") Long id) {
    return ResponseConstructor.build(Response.Status.OK, "Opportunity", view(RecordAccess.readable(FundingOpportunity.class, id)));
  }

  @POST
  @Path("/opportunities")
  @Consumes(MediaType.APPLICATION_JSON)
  @Operation(summary = "Open a grant, donation or sponsorship opportunity for a donor", tags = {"IOETI fundraising"})
  @IoetiEndpoint
  public Response createOpportunity(CreateFundingOpportunity command) {
    if (command == null) throw ApiException.badRequest("Opportunity details are required.");
    new SecurityCheck().createAccess(FundingOpportunity.class).check();
    FundingOpportunity opportunity = new FundingOpportunity();
    opportunity.setReference(reference(command.reference()));
    opportunity.setDonor(readableDonor(command.donorId()));
    opportunity.setTitle(checkedText("title", command.title(), 255, true));
    opportunity.setPurpose(checkedText("purpose", command.purpose(), 255, false));
    opportunity.setKindSelect(select("kind", command.kind(), KINDS));
    opportunity.setStageSelect(FundingOpportunityRepository.STAGE_IDENTIFIED);
    opportunity.setProposedAmount(command.proposedAmount() == null ? null : amount("proposedAmount", command.proposedAmount()));
    opportunity.setCurrency(currency(command.currencyCode()));
    opportunity.setDeadline(command.deadline() == null || command.deadline().isBlank() ? null : requiredDate("deadline", command.deadline()));
    opportunity.setCampaign(campaign(command.campaignId()));
    opportunity.setOwner(AuthUtils.getUser());
    FundingOpportunity[] saved = new FundingOpportunity[1];
    write(() -> saved[0] = Beans.get(FundraisingService.class).create(opportunity));
    return ResponseConstructor.build(Response.Status.CREATED, "Opportunity opened", view(saved[0]));
  }

  @POST
  @Path("/opportunities/{id}/stage")
  @Consumes(MediaType.APPLICATION_JSON)
  @Operation(summary = "Move to proposal or submitted, or record a decline or withdrawal", tags = {"IOETI fundraising"})
  @IoetiEndpoint
  public Response move(@PathParam("id") Long id, ChangeStage command) {
    FundingOpportunity opportunity = writable(FundingOpportunity.class, id, command == null ? null : command.version());
    Integer stage = command.stage() == null ? null : MOVABLE.get(command.stage());
    if (stage == null) throw ApiException.invalidField("stage", "UNAVAILABLE", "Use PROPOSAL, SUBMITTED, DECLINED or WITHDRAWN.");
    write(() -> Beans.get(FundraisingService.class).move(opportunity, stage));
    return ResponseConstructor.build(Response.Status.OK, "Stage changed", view(opportunity));
  }

  @POST
  @Path("/opportunities/{id}/approve")
  @Consumes(MediaType.APPLICATION_JSON)
  @Operation(summary = "Record the donor's approval as a commitment (not cash and not revenue)", tags = {"IOETI fundraising"})
  @IoetiEndpoint
  public Response approve(@PathParam("id") Long id, Approve command) {
    FundingOpportunity opportunity = writable(FundingOpportunity.class, id, command == null ? null : command.version());
    new SecurityCheck().createAccess(FundingCommitment.class).check();
    FundingCommitment values = new FundingCommitment();
    values.setCommittedAmount(amount("committedAmount", command.committedAmount()));
    LocalDate approvedOn = requiredDate("approvedOn", command.approvedOn());
    if (approvedOn.isAfter(LocalDate.now())) throw ApiException.invalidField("approvedOn", "RANGE", "An approval cannot be dated in the future.");
    values.setApprovedOn(approvedOn);
    if (command.periodEnd() != null && !command.periodEnd().isBlank()) {
      LocalDate end = requiredDate("periodEnd", command.periodEnd());
      if (end.isBefore(approvedOn)) throw ApiException.invalidField("periodEnd", "RANGE", "The grant period ends after the approval.");
      values.setPeriodEnd(end);
    }
    boolean restricted = Boolean.TRUE.equals(command.restricted());
    values.setRestricted(restricted);
    values.setRestrictionPurpose(checkedText("restrictionPurpose", command.restrictionPurpose(), 255, restricted));
    values.setAgreementReference(checkedText("agreementReference", command.agreementReference(), 60, false));
    FundingCommitment[] saved = new FundingCommitment[1];
    write(() -> saved[0] = Beans.get(FundraisingService.class).approve(opportunity, values));
    return ResponseConstructor.build(Response.Status.CREATED, "Commitment recorded", view(saved[0]));
  }

  @POST
  @Path("/opportunities/{id}/archive")
  @Consumes(MediaType.APPLICATION_JSON)
  @Operation(summary = "Archive an opportunity without a commitment (kept for history, hidden from lists)", tags = {"IOETI fundraising"})
  @IoetiEndpoint
  public Response archive(@PathParam("id") Long id, VersionOnly command) {
    FundingOpportunity opportunity = writable(FundingOpportunity.class, id, command == null ? null : command.version());
    write(() -> Beans.get(FundraisingService.class).archive(opportunity));
    return ResponseConstructor.build(Response.Status.OK, "Opportunity archived", view(opportunity));
  }

  @POST
  @Path("/opportunities/{id}/renewal")
  @Consumes(MediaType.APPLICATION_JSON)
  @Operation(summary = "Open the renewal of an approved opportunity", tags = {"IOETI fundraising"})
  @IoetiEndpoint
  public Response renew(@PathParam("id") Long id, Renew command) {
    FundingOpportunity previous = writable(FundingOpportunity.class, id, command == null ? null : command.version());
    new SecurityCheck().createAccess(FundingOpportunity.class).check();
    if (previous.getStageSelect() != FundingOpportunityRepository.STAGE_APPROVED) {
      throw new ApiException(422, "STAGE_TRANSITION", "Only an approved opportunity can be renewed.", null);
    }
    FundingOpportunity renewal = new FundingOpportunity();
    renewal.setReference(reference(command.reference()));
    renewal.setDonor(previous.getDonor());
    renewal.setTitle(previous.getTitle());
    renewal.setPurpose(previous.getPurpose());
    renewal.setKindSelect(previous.getKindSelect());
    renewal.setStageSelect(FundingOpportunityRepository.STAGE_IDENTIFIED);
    renewal.setCurrency(previous.getCurrency());
    renewal.setCampaign(previous.getCampaign());
    renewal.setDeadline(command.deadline() == null || command.deadline().isBlank() ? null : requiredDate("deadline", command.deadline()));
    renewal.setRenewalOf(previous);
    renewal.setOwner(AuthUtils.getUser());
    FundingOpportunity[] saved = new FundingOpportunity[1];
    write(() -> saved[0] = Beans.get(FundraisingService.class).create(renewal));
    return ResponseConstructor.build(Response.Status.CREATED, "Renewal opened", view(saved[0]));
  }

  // --- commitments, schedule and collections -------------------------------------------------------

  @GET
  @Path("/commitments/{id}")
  @Operation(summary = "A commitment with committed, scheduled, collected and outstanding amounts kept apart", tags = {"IOETI fundraising"})
  @IoetiEndpoint
  public Response commitment(@PathParam("id") Long id) {
    return ResponseConstructor.build(Response.Status.OK, "Commitment", view(RecordAccess.readable(FundingCommitment.class, id)));
  }

  @GET
  @Path("/commitments/{id}/installments")
  @Operation(summary = "Payment schedule with what was collected on each installment", tags = {"IOETI fundraising"})
  @IoetiEndpoint
  public Response installments(@PathParam("id") Long id) {
    FundingCommitment commitment = RecordAccess.readable(FundingCommitment.class, id);
    new SecurityCheck().readAccess(PledgeInstallment.class).check();
    List<InstallmentView> rows = readable(PledgeInstallment.class, new JPQLFilter("self.commitment.id = ?", commitment.getId()))
        .order("sequence").fetch(500).stream().map(FundraisingRestController::view).toList();
    return ResponseConstructor.build(Response.Status.OK, "Installments", rows);
  }

  @POST
  @Path("/commitments/{id}/installments")
  @Consumes(MediaType.APPLICATION_JSON)
  @Operation(summary = "Add an installment; the schedule never exceeds the committed amount", tags = {"IOETI fundraising"})
  @IoetiEndpoint
  public Response schedule(@PathParam("id") Long id, Schedule command) {
    FundingCommitment commitment = writable(FundingCommitment.class, id, command == null ? null : command.version());
    new SecurityCheck().createAccess(PledgeInstallment.class).check();
    LocalDate due = requiredDate("dueDate", command.dueDate());
    BigDecimal value = amount("amount", command.amount());
    PledgeInstallment[] saved = new PledgeInstallment[1];
    write(() -> saved[0] = Beans.get(FundraisingService.class).schedule(commitment, due, value));
    return ResponseConstructor.build(Response.Status.CREATED, "Installment scheduled", view(saved[0]));
  }

  @POST
  @Path("/installments/{id}/cancel")
  @Consumes(MediaType.APPLICATION_JSON)
  @Operation(summary = "Cancel an installment without collections (kept for history)", tags = {"IOETI fundraising"})
  @IoetiEndpoint
  public Response cancel(@PathParam("id") Long id, VersionOnly command) {
    PledgeInstallment installment = writable(PledgeInstallment.class, id, command == null ? null : command.version());
    write(() -> Beans.get(FundraisingService.class).cancel(installment));
    return ResponseConstructor.build(Response.Status.OK, "Installment cancelled", view(installment));
  }

  @GET
  @Path("/installments/{id}/collections")
  @Operation(summary = "Collections recorded on an installment, voided ones included", tags = {"IOETI fundraising"})
  @IoetiEndpoint
  public Response collections(@PathParam("id") Long id) {
    PledgeInstallment installment = RecordAccess.readable(PledgeInstallment.class, id);
    new SecurityCheck().readAccess(DonationCollection.class).check();
    List<CollectionView> rows = readable(DonationCollection.class, new JPQLFilter("self.installment.id = ?", installment.getId()))
        .order("id").fetch(500).stream().map(FundraisingRestController::view).toList();
    return ResponseConstructor.build(Response.Status.OK, "Collections", rows);
  }

  @POST
  @Path("/installments/{id}/collections")
  @Consumes(MediaType.APPLICATION_JSON)
  @Operation(summary = "Record money received against a bank reference (no receipt, no posting)", tags = {"IOETI fundraising"})
  @IoetiEndpoint
  public Response collect(@PathParam("id") Long id, RecordCollection command) {
    PledgeInstallment installment = writable(PledgeInstallment.class, id, command == null ? null : command.version());
    new SecurityCheck().createAccess(DonationCollection.class).check();
    BigDecimal value = amount("amount", command.amount());
    LocalDate received = requiredDate("receivedOn", command.receivedOn());
    if (received.isAfter(LocalDate.now())) throw ApiException.invalidField("receivedOn", "RANGE", "Money cannot be received in the future.");
    String reference = checkedText("bankReference", command.bankReference(), 60, true);
    DonationCollection[] saved = new DonationCollection[1];
    write(() -> saved[0] = Beans.get(FundraisingService.class).collect(installment, value, received, reference));
    return ResponseConstructor.build(Response.Status.CREATED, "Collection recorded", view(saved[0]));
  }

  @POST
  @Path("/collections/{id}/void")
  @Consumes(MediaType.APPLICATION_JSON)
  @Operation(summary = "Void a collection recorded by mistake; the row stays for the audit trail", tags = {"IOETI fundraising"})
  @IoetiEndpoint
  public Response voidCollection(@PathParam("id") Long id, VoidCollection command) {
    DonationCollection collection = writable(DonationCollection.class, id, command == null ? null : command.version());
    int reason = select("reason", command.reason(), VOID_REASONS);
    write(() -> Beans.get(FundraisingService.class).voidCollection(collection, reason));
    return ResponseConstructor.build(Response.Status.OK, "Collection voided", view(collection));
  }

  @POST
  @Path("/collections/{id}/receipt")
  @Operation(summary = "Finance issues the donation receipt of a recorded collection (D-05): once, uniquely numbered", tags = {"IOETI fundraising"})
  @IoetiEndpoint
  public Response receipt(@PathParam("id") Long id) {
    new SecurityCheck().createAccess(DonationReceipt.class).check();
    DonationCollection collection = RecordAccess.readable(DonationCollection.class, id);
    DonationReceipt[] saved = new DonationReceipt[1];
    write(() -> saved[0] = Beans.get(FundraisingService.class).issueReceipt(collection, LocalDate.now()));
    return ResponseConstructor.build(Response.Status.CREATED, "Receipt issued", view(saved[0]));
  }

  @GET
  @Path("/receipts")
  @Operation(summary = "Donation receipts the caller may read, newest first; status ISSUED or VOIDED", tags = {"IOETI fundraising"})
  @IoetiEndpoint
  public Response receipts(@QueryParam("status") String status, @QueryParam("collectionId") Long collectionId) {
    new SecurityCheck().readAccess(DonationReceipt.class).check();
    List<String> conditions = new ArrayList<>();
    List<Object> params = new ArrayList<>();
    if (status != null && !status.isBlank()) {
      conditions.add("self.statusSelect = ?");
      params.add(select("status", status, "ISSUED", "VOIDED"));
    }
    if (collectionId != null) {
      conditions.add("self.collection.id = ?");
      params.add(collectionId);
    }
    Filter where = conditions.isEmpty() ? null : new JPQLFilter(String.join(" AND ", conditions), params.toArray());
    List<ReceiptView> rows = readable(DonationReceipt.class, where).order("-id").fetch(500).stream()
        .map(FundraisingRestController::view).toList();
    return ResponseConstructor.build(Response.Status.OK, "Receipts", rows);
  }

  @GET
  @Path("/receipts/{id}")
  @Operation(summary = "One donation receipt, for printing", tags = {"IOETI fundraising"})
  @IoetiEndpoint
  public Response receiptRecord(@PathParam("id") Long id) {
    return ResponseConstructor.build(Response.Status.OK, "Receipt", view(RecordAccess.readable(DonationReceipt.class, id)));
  }

  @POST
  @Path("/receipts/{id}/void")
  @Consumes(MediaType.APPLICATION_JSON)
  @Operation(summary = "Void a receipt with a reason; it keeps its number and a reissue gets a new one", tags = {"IOETI fundraising"})
  @IoetiEndpoint
  public Response voidReceipt(@PathParam("id") Long id, VoidCollection command) {
    DonationReceipt receipt = writable(DonationReceipt.class, id, command == null ? null : command.version());
    int reason = select("reason", command.reason(), RECEIPT_VOID_REASONS);
    write(() -> Beans.get(FundraisingService.class).voidReceipt(receipt, reason));
    return ResponseConstructor.build(Response.Status.OK, "Receipt voided", view(receipt));
  }

  @POST
  @Path("/collections/{id}/post")
  @Operation(summary = "Post a collection to accounting: blocked until D-06", tags = {"IOETI fundraising"})
  @IoetiEndpoint
  public Response post(@PathParam("id") Long id) {
    RecordAccess.writable(DonationCollection.class, id);
    throw ApiException.policyBlocked("D-06");
  }

  @POST
  @Path("/installments/{id}/invoice")
  @Operation(summary = "Invoice an installment: blocked until D-06", tags = {"IOETI fundraising"})
  @IoetiEndpoint
  public Response invoice(@PathParam("id") Long id) {
    RecordAccess.writable(PledgeInstallment.class, id);
    throw ApiException.policyBlocked("D-06");
  }

  @POST
  @Path("/commitments/{id}/allocate")
  @Consumes(MediaType.APPLICATION_JSON)
  @Operation(summary = "Finance allocates a restricted commitment to a restriction (its analytic account), once (D-05)", tags = {"IOETI fundraising"})
  @IoetiEndpoint
  public Response allocate(@PathParam("id") Long id, Allocate command) {
    new SecurityCheck().writeAccess(FundRestriction.class).check();
    if (command == null || command.version() == null) throw ApiException.badRequest("Record version is required.");
    FundingCommitment commitment = RecordAccess.readable(FundingCommitment.class, id);
    ConflictChecker.checkVersion(commitment, command.version());
    FundRestriction restriction = command.restrictionId() == null || command.restrictionId() <= 0 ? null
        : JPA.find(FundRestriction.class, command.restrictionId());
    if (restriction == null || !Beans.get(JpaSecurity.class).isPermitted(JpaSecurity.CAN_READ, FundRestriction.class, restriction.getId())) {
      throw ApiException.invalidField("restrictionId", "UNAVAILABLE", "Choose a restriction you can see.");
    }
    write(() -> Beans.get(FundraisingService.class).allocate(commitment, restriction));
    return ResponseConstructor.build(Response.Status.OK, "Commitment allocated", view(commitment));
  }

  // --- D-05: fund restrictions and their analytic accounts ------------------------------------------

  @GET
  @Path("/fund-restrictions")
  @Operation(summary = "Donor restrictions and the analytic account each maps to", tags = {"IOETI fundraising"})
  @IoetiEndpoint
  public Response restrictions() {
    new SecurityCheck().readAccess(FundRestriction.class).check();
    List<RestrictionView> rows = readable(FundRestriction.class, null).order("code").fetch(500).stream()
        .map(FundraisingRestController::view).toList();
    return ResponseConstructor.build(Response.Status.OK, "Fund restrictions", rows);
  }

  @POST
  @Path("/fund-restrictions")
  @Consumes(MediaType.APPLICATION_JSON)
  @Operation(summary = "Finance maps a donor restriction to an active native analytic account", tags = {"IOETI fundraising"})
  @IoetiEndpoint
  public Response createRestriction(SaveRestriction command) {
    if (command == null) throw ApiException.badRequest("Restriction details are required.");
    new SecurityCheck().createAccess(FundRestriction.class).check();
    String code = command.code() == null ? "" : command.code().strip().toUpperCase();
    if (!RESTRICTION_CODE.matcher(code).matches()) throw ApiException.invalidField("code", "FORMAT", "Use 2 to 30 letters, digits or dashes.");
    if (Query.of(FundRestriction.class).filter("self.code = ?", code).count() > 0) {
      throw ApiException.invalidField("code", "DUPLICATE", "Another restriction already uses this code.");
    }
    FundRestriction restriction = new FundRestriction();
    restriction.setCode(code);
    String name = checkedText("name", command.name(), 255, true);
    AnalyticAccount account = analyticAccount(command.analyticAccountId(), true);
    FundRestriction[] saved = new FundRestriction[1];
    write(() -> saved[0] = Beans.get(FundraisingService.class).saveRestriction(restriction, name, account, true));
    return ResponseConstructor.build(Response.Status.CREATED, "Restriction mapped", view(saved[0]));
  }

  @POST
  @Path("/fund-restrictions/{id}")
  @Consumes(MediaType.APPLICATION_JSON)
  @Operation(summary = "Rename, remap (future allocations only) or deactivate a restriction", tags = {"IOETI fundraising"})
  @IoetiEndpoint
  public Response updateRestriction(@PathParam("id") Long id, SaveRestriction command) {
    FundRestriction restriction = writable(FundRestriction.class, id, command == null ? null : command.version());
    String name = checkedText("name", command.name(), 255, false);
    AnalyticAccount account = analyticAccount(command.analyticAccountId(), false);
    write(() -> Beans.get(FundraisingService.class).saveRestriction(restriction, name, account, command.active()));
    return ResponseConstructor.build(Response.Status.OK, "Restriction updated", view(restriction));
  }

  @GET
  @Path("/analytic-accounts")
  @Operation(summary = "Active native analytic accounts the caller may read, to map restrictions to", tags = {"IOETI fundraising"})
  @IoetiEndpoint
  public Response analyticAccounts(@QueryParam("q") String q) {
    new SecurityCheck().readAccess(AnalyticAccount.class).check();
    String search = checkedText("q", q, 100, false);
    List<String> conditions = new ArrayList<>(List.of("self.statusSelect = ?"));
    List<Object> params = new ArrayList<>(List.of(AnalyticAccountRepository.STATUS_ACTIVE));
    if (search != null) {
      conditions.add("(LOWER(self.code) LIKE ? OR LOWER(self.name) LIKE ?)");
      String like = "%" + search.toLowerCase().replace("%", "").replace("_", "") + "%";
      params.add(like);
      params.add(like);
    }
    List<AnalyticAccountView> rows = readable(AnalyticAccount.class, new JPQLFilter(String.join(" AND ", conditions), params.toArray()))
        .order("code").fetch(200).stream().map(a -> new AnalyticAccountView(a.getId(), a.getCode(), a.getName())).toList();
    return ResponseConstructor.build(Response.Status.OK, "Analytic accounts", rows);
  }

  @GET
  @Path("/restricted-funds")
  @Operation(summary = "Restricted funds per restriction and currency: committed and collected, with the analytic account; unallocated apart", tags = {"IOETI fundraising"})
  @IoetiEndpoint
  public Response restrictedFunds() {
    new SecurityCheck().readAccess(FundRestriction.class).readAccess(FundingCommitment.class).readAccess(DonationCollection.class).check();
    Map<String, BigDecimal[]> sums = new TreeMap<>();
    Map<String, FundRestriction> byKey = new LinkedHashMap<>();
    for (FundingCommitment c : readable(FundingCommitment.class, new JPQLFilter("self.restricted = true")).fetch(5000)) {
      String key = key(c.getFundRestriction(), c.getOpportunity().getCurrency().getCodeISO());
      byKey.putIfAbsent(key, c.getFundRestriction());
      BigDecimal[] t = sums.computeIfAbsent(key, k -> new BigDecimal[] {BigDecimal.ZERO, BigDecimal.ZERO, BigDecimal.ZERO});
      t[0] = t[0].add(c.getCommittedAmount());
      t[2] = t[2].add(BigDecimal.ONE);
    }
    for (DonationCollection k : readable(DonationCollection.class, new JPQLFilter(
        "self.statusSelect = ? AND self.installment.commitment.restricted = true", DonationCollectionRepository.STATUS_RECORDED)).fetch(20000)) {
      // the restriction the collection was allocated to when it was recorded; unallocated ones are counted apart
      FundRestriction r = k.getFundRestriction();
      String key = key(r, k.getInstallment().getCommitment().getOpportunity().getCurrency().getCodeISO());
      byKey.putIfAbsent(key, r);
      BigDecimal[] t = sums.computeIfAbsent(key, x -> new BigDecimal[] {BigDecimal.ZERO, BigDecimal.ZERO, BigDecimal.ZERO});
      t[1] = t[1].add(k.getAmount());
    }
    List<RestrictedFundView> rows = new ArrayList<>();
    sums.forEach((key, t) -> {
      FundRestriction r = byKey.get(key);
      AnalyticAccount a = r == null ? null : r.getAnalyticAccount();
      rows.add(new RestrictedFundView(r == null ? null : r.getId(), r == null ? null : r.getCode(), r == null ? null : r.getName(),
          a == null ? null : a.getCode(), a == null ? null : a.getName(), key.substring(key.lastIndexOf('|') + 1), t[0], t[1],
          t[2].longValue(), r != null));
    });
    return ResponseConstructor.build(Response.Status.OK, "Restricted funds", rows);
  }

  private static String key(FundRestriction r, String currency) {
    return (r == null ? "~UNALLOCATED" : r.getCode()) + "|" + currency;
  }

  /** An analytic account the caller may read and that is active (native status). */
  private static AnalyticAccount analyticAccount(Long id, boolean required) {
    if (id == null && !required) return null;
    AnalyticAccount account = id == null || id <= 0 ? null : JPA.find(AnalyticAccount.class, id);
    if (account == null || !Beans.get(JpaSecurity.class).isPermitted(JpaSecurity.CAN_READ, AnalyticAccount.class, account.getId())) {
      throw ApiException.invalidField("analyticAccountId", "UNAVAILABLE", "Choose an analytic account you can see.");
    }
    if (!Integer.valueOf(AnalyticAccountRepository.STATUS_ACTIVE).equals(account.getStatusSelect())) {
      throw ApiException.invalidField("analyticAccountId", "INACTIVE", "Choose an active analytic account.");
    }
    return account;
  }

  // --- deliverables --------------------------------------------------------------------------------

  @GET
  @Path("/commitments/{id}/deliverables")
  @Operation(summary = "Grant deliverables (reports and obligations to the donor)", tags = {"IOETI fundraising"})
  @IoetiEndpoint
  public Response deliverables(@PathParam("id") Long id) {
    FundingCommitment commitment = RecordAccess.readable(FundingCommitment.class, id);
    new SecurityCheck().readAccess(GrantDeliverable.class).check();
    List<DeliverableView> rows = readable(GrantDeliverable.class, new JPQLFilter("self.commitment.id = ?", commitment.getId()))
        .order("dueDate").fetch(500).stream().map(FundraisingRestController::view).toList();
    return ResponseConstructor.build(Response.Status.OK, "Deliverables", rows);
  }

  @POST
  @Path("/commitments/{id}/deliverables")
  @Consumes(MediaType.APPLICATION_JSON)
  @Operation(summary = "Add a deliverable owed to the donor", tags = {"IOETI fundraising"})
  @IoetiEndpoint
  public Response addDeliverable(@PathParam("id") Long id, AddDeliverable command) {
    FundingCommitment commitment = writable(FundingCommitment.class, id, command == null ? null : command.version());
    new SecurityCheck().createAccess(GrantDeliverable.class).check();
    String title = checkedText("title", command.title(), 255, true);
    LocalDate due = requiredDate("dueDate", command.dueDate());
    GrantDeliverable[] saved = new GrantDeliverable[1];
    write(() -> saved[0] = Beans.get(FundraisingService.class).addDeliverable(commitment, title, due));
    return ResponseConstructor.build(Response.Status.CREATED, "Deliverable added", view(saved[0]));
  }

  @POST
  @Path("/deliverables/{id}/status")
  @Consumes(MediaType.APPLICATION_JSON)
  @Operation(summary = "Mark a deliverable submitted, then accepted by the donor", tags = {"IOETI fundraising"})
  @IoetiEndpoint
  public Response advance(@PathParam("id") Long id, ChangeStage command) {
    GrantDeliverable deliverable = writable(GrantDeliverable.class, id, command == null ? null : command.version());
    int status = "SUBMITTED".equals(command.stage()) ? GrantDeliverableRepository.STATUS_SUBMITTED
        : "ACCEPTED".equals(command.stage()) ? GrantDeliverableRepository.STATUS_ACCEPTED : -1;
    if (status < 0) throw ApiException.invalidField("stage", "UNAVAILABLE", "Use SUBMITTED or ACCEPTED.");
    write(() -> Beans.get(FundraisingService.class).advance(deliverable, status, LocalDate.now()));
    return ResponseConstructor.build(Response.Status.OK, "Deliverable updated", view(deliverable));
  }

  // --- helpers -------------------------------------------------------------------------------------

  private static <T extends Model> Query<T> readable(Class<T> type, Filter condition) {
    Filter security = Beans.get(JpaSecurity.class).getFilter(JpaSecurity.CAN_READ, type);
    Filter combined = security == null ? condition : condition == null ? security : Filter.and(security, condition);
    return combined == null ? Query.of(type) : combined.build(type);
  }

  private static <T extends AuditableModel> T writable(Class<T> type, Long id, Integer version) {
    if (version == null) throw ApiException.badRequest("Record version is required.");
    T record = RecordAccess.writable(type, id);
    ConflictChecker.checkVersion(record, version);
    return record;
  }

  private static void write(Runnable command) {
    OptimisticLockConflicts.translate(command::run);
  }

  private static DonorProfile readableDonor(Long id) {
    DonorProfile donor = id == null || id <= 0 ? null : JPA.find(DonorProfile.class, id);
    if (donor == null || !Beans.get(JpaSecurity.class).isPermitted(JpaSecurity.CAN_READ, DonorProfile.class, donor.getId())) {
      throw ApiException.invalidField("donorId", "UNAVAILABLE", "Choose a donor you can see.");
    }
    return donor;
  }

  private static Campaign campaign(Long id) {
    if (id == null) return null;
    Campaign campaign = id <= 0 ? null : JPA.find(Campaign.class, id);
    if (campaign == null || !Beans.get(JpaSecurity.class).isPermitted(JpaSecurity.CAN_READ, Campaign.class, campaign.getId())) {
      throw ApiException.invalidField("campaignId", "UNAVAILABLE", "Choose a campaign you can see.");
    }
    return campaign;
  }

  /** Currencies are reference data; the code must exist, nothing is converted. */
  private static Currency currency(String code) {
    Currency currency = code == null || !code.matches("[A-Z]{3}") ? null
        : Query.of(Currency.class).filter("self.codeISO = ?1", code).fetchOne();
    if (currency == null) throw ApiException.invalidField("currencyCode", "UNAVAILABLE", "Use a configured currency code such as EGP.");
    return currency;
  }

  private static String reference(String value) {
    String reference = value == null ? "" : value.strip().toUpperCase();
    if (!REFERENCE.matcher(reference).matches()) {
      throw ApiException.invalidField("reference", "FORMAT", "Use 2 to 30 letters, digits or dashes.");
    }
    if (Query.of(FundingOpportunity.class).filter("self.reference = ?", reference).count() > 0) {
      throw ApiException.invalidField("reference", "DUPLICATE", "Another opportunity already uses this reference.");
    }
    return reference;
  }

  static BigDecimal amount(String field, BigDecimal value) {
    if (value == null) throw ApiException.invalidField(field, "REQUIRED", "This field is required.");
    if (value.signum() <= 0 || value.compareTo(MAX_AMOUNT) >= 0 || value.stripTrailingZeros().scale() > 2) {
      throw ApiException.invalidField(field, "RANGE", "Enter a positive amount with up to 2 decimals.");
    }
    return value;
  }

  static int select(String field, String value, String... names) {
    for (int i = 0; i < names.length; i++) if (names[i].equals(value)) return i + 1;
    throw ApiException.invalidField(field, "UNAVAILABLE", "Use one of " + String.join(", ", names) + ".");
  }

  static String checkedText(String field, String value, int max, boolean required) {
    String text = value == null ? null : value.strip();
    if (text == null || text.isEmpty()) {
      if (required) throw ApiException.invalidField(field, "REQUIRED", "This field is required.");
      return null;
    }
    if (text.length() > max) {
      throw ApiException.invalidField(field, "TOO_LONG", "This field can have at most " + max + " characters.");
    }
    return text;
  }

  static LocalDate requiredDate(String field, String value) {
    try {
      if (value != null && !value.isBlank()) return LocalDate.parse(value);
    } catch (DateTimeParseException e) {
      // falls through to the field error
    }
    throw ApiException.invalidField(field, "FORMAT", "Use a date like 2026-11-01.");
  }

  static String name(Integer select, String... names) {
    return select == null || select < 1 || select > names.length ? null : names[select - 1];
  }

  private static String userName(User user) {
    return user == null ? null : user.getName();
  }

  private static boolean managedByMe(DonorProfile donor) {
    return donor.getRelationshipManager() != null && donor.getRelationshipManager().equals(AuthUtils.getUser());
  }

  /** An anonymous donor is named only to the relationship manager; others see no name. */
  static String donorName(DonorProfile donor) {
    if (Boolean.TRUE.equals(donor.getAnonymous()) && !managedByMe(donor)) return null;
    Partner partner = donor.getPartner();
    return Beans.get(JpaSecurity.class).isPermitted(JpaSecurity.CAN_READ, Partner.class, partner.getId()) ? partner.getName() : null;
  }

  /** Sums per currency; amounts in different currencies are never added together. */
  static List<MoneyTotals> totals(List<FundingOpportunity> opportunities) {
    Map<String, BigDecimal[]> byCurrency = new TreeMap<>();
    for (FundingOpportunity o : opportunities) {
      BigDecimal[] t = byCurrency.computeIfAbsent(o.getCurrency().getCodeISO(),
          k -> new BigDecimal[] {BigDecimal.ZERO, BigDecimal.ZERO, BigDecimal.ZERO, BigDecimal.ZERO, BigDecimal.ZERO});
      if (FundraisingService.isOpen(o.getStageSelect()) && o.getProposedAmount() != null) t[0] = t[0].add(o.getProposedAmount());
      FundingCommitment c = FundraisingService.commitment(o);
      if (c == null) continue;
      t[1] = t[1].add(c.getCommittedAmount());
      t[2] = t[2].add(FundraisingService.scheduled(c));
      t[3] = t[3].add(FundraisingService.collected(c));
      if (Boolean.TRUE.equals(c.getRestricted())) t[4] = t[4].add(c.getCommittedAmount());
    }
    List<MoneyTotals> rows = new ArrayList<>();
    byCurrency.forEach((code, t) -> rows.add(new MoneyTotals(code, t[0], t[1], t[2], t[3], t[1].subtract(t[3]), t[4])));
    return rows;
  }

  private static List<InstallmentStatusView> installmentRows(String status) {
    LocalDate today = LocalDate.now();
    List<InstallmentStatusView> rows = new ArrayList<>();
    for (PledgeInstallment i : readable(PledgeInstallment.class,
        new JPQLFilter("(self.commitment.opportunity.archived IS NULL OR self.commitment.opportunity.archived = false)"))
        .order("dueDate").fetch(1000)) {
      BigDecimal collected = FundraisingService.collected(i);
      String state = FundraisingService.collectionStatus(i, collected, today);
      if (status != null && !status.equals(state)) continue;
      FundingOpportunity o = i.getCommitment().getOpportunity();
      rows.add(new InstallmentStatusView(i.getId(), i.getCommitment().getId(), o.getReference(), donorName(o.getDonor()),
          i.getSequence(), i.getDueDate(), i.getAmount(), collected, o.getCurrency().getCodeISO(), state));
      if (rows.size() >= 500) break;
    }
    return rows;
  }

  static DonorView view(DonorProfile donor) {
    long open = Query.of(FundingOpportunity.class)
        .filter("self.donor = ?1 AND self.stageSelect IN (1, 2, 3) AND (self.archived IS NULL OR self.archived = false)", donor).count();
    String name = donorName(donor);
    return new DonorView(donor.getId(), donor.getVersion(), name == null ? null : donor.getPartner().getId(), name,
        Boolean.TRUE.equals(donor.getAnonymous()), name(donor.getDonorTypeSelect(), DONOR_TYPES), managedByMe(donor),
        userName(donor.getRelationshipManager()), FundraisingService.sensitive(donor) != null, open);
  }

  static FundingOpportunityView view(FundingOpportunity o) {
    FundingCommitment c = FundraisingService.commitment(o);
    Campaign campaign = o.getCampaign();
    boolean canReadCampaign = campaign != null
        && Beans.get(JpaSecurity.class).isPermitted(JpaSecurity.CAN_READ, Campaign.class, campaign.getId());
    return new FundingOpportunityView(o.getId(), o.getVersion(), o.getReference(), o.getDonor().getId(), donorName(o.getDonor()),
        o.getTitle(), o.getPurpose(), name(o.getKindSelect(), KINDS), name(o.getStageSelect(), STAGES), o.getProposedAmount(),
        o.getCurrency().getCodeISO(), o.getDeadline(), canReadCampaign ? campaign.getId() : null, canReadCampaign ? campaign.getName() : null,
        o.getRenewalOf() == null ? null : o.getRenewalOf().getReference(), c == null ? null : c.getId(),
        Boolean.TRUE.equals(o.getArchived()), managedByMe(o.getDonor()));
  }

  static CommitmentView view(FundingCommitment c) {
    FundingOpportunity o = c.getOpportunity();
    BigDecimal scheduled = FundraisingService.scheduled(c);
    BigDecimal collected = FundraisingService.collected(c);
    long pending = Query.of(GrantDeliverable.class).filter("self.commitment = ?1 AND self.statusSelect < ?2", c,
        GrantDeliverableRepository.STATUS_ACCEPTED).count();
    JpaSecurity security = Beans.get(JpaSecurity.class);
    FundRestriction r = c.getFundRestriction();
    boolean restricted = Boolean.TRUE.equals(c.getRestricted());
    return new CommitmentView(c.getId(), c.getVersion(), o.getId(), o.getReference(), o.getTitle(), donorName(o.getDonor()),
        o.getCurrency().getCodeISO(), c.getCommittedAmount(), scheduled, collected, c.getCommittedAmount().subtract(collected),
        c.getCommittedAmount().subtract(scheduled), restricted, c.getRestrictionPurpose(),
        c.getAgreementReference(), c.getApprovedOn(), c.getPeriodEnd(), pending,
        !restricted ? "NOT_RESTRICTED" : r == null ? "PENDING_ALLOCATION" : "ALLOCATED",
        r == null ? null : r.getId(), r == null ? null : r.getCode(), r == null ? null : r.getName(), analyticLabel(r == null ? null : r.getAnalyticAccount()),
        "NOT_POSTED", restricted && r == null && security.isPermitted(JpaSecurity.CAN_WRITE, FundRestriction.class),
        security.isPermitted(JpaSecurity.CAN_CREATE, DonationReceipt.class), managedByMe(o.getDonor()));
  }

  static InstallmentView view(PledgeInstallment i) {
    BigDecimal collected = FundraisingService.collected(i);
    return new InstallmentView(i.getId(), i.getVersion(), i.getSequence(), i.getDueDate(), i.getAmount(), collected,
        FundraisingService.collectionStatus(i, collected, LocalDate.now()));
  }

  static CollectionView view(DonationCollection k) {
    JpaSecurity security = Beans.get(JpaSecurity.class);
    boolean voided = k.getStatusSelect() == DonationCollectionRepository.STATUS_VOIDED;
    DonationReceipt receipt = FundraisingService.receiptInForce(k);
    boolean receiptReadable = receipt != null && security.isPermitted(JpaSecurity.CAN_READ, DonationReceipt.class, receipt.getId());
    boolean restricted = Boolean.TRUE.equals(k.getInstallment().getCommitment().getRestricted());
    return new CollectionView(k.getId(), k.getVersion(), k.getAmount(), k.getReceivedOn(), voided ? "VOIDED" : "RECORDED",
        name(k.getVoidReasonSelect(), VOID_REASONS), userName(k.getCreatedBy()),
        receipt != null ? "ISSUED" : voided ? "NOT_ALLOWED" : "NOT_ISSUED", receiptReadable ? receipt.getId() : null,
        receiptReadable ? receipt.getNumber() : null, FundraisingService.voidedReceipts(k),
        !voided && receipt == null && security.isPermitted(JpaSecurity.CAN_CREATE, DonationReceipt.class),
        !restricted ? "NOT_RESTRICTED" : k.getFundRestriction() == null ? "PENDING_ALLOCATION" : "ALLOCATED",
        analyticLabel(k.getAnalyticAccount()));
  }

  static String analyticLabel(AnalyticAccount a) {
    return a == null ? null : a.getCode() + " - " + a.getName();
  }

  static ReceiptView view(DonationReceipt r) {
    DonationCollection k = r.getCollection();
    FundingCommitment c = k.getInstallment().getCommitment();
    FundingOpportunity o = c.getOpportunity();
    return new ReceiptView(r.getId(), r.getVersion(), r.getNumber(),
        r.getStatusSelect() == DonationReceiptRepository.STATUS_VOIDED ? "VOIDED" : "ISSUED", k.getId(), o.getId(), o.getReference(),
        o.getTitle(), r.getDonorName(), r.getAmount(), r.getCurrency().getCodeISO(), r.getReceivedOn(), r.getIssuedOn(),
        userName(r.getIssuedBy()), Boolean.TRUE.equals(c.getRestricted()) ? c.getRestrictionPurpose() : null,
        name(r.getVoidReasonSelect(), RECEIPT_VOID_REASONS), r.getVoidedAt(), r.getReplaces() == null ? null : r.getReplaces().getNumber(),
        r.getStatusSelect() == DonationReceiptRepository.STATUS_ISSUED
            && Beans.get(JpaSecurity.class).isPermitted(JpaSecurity.CAN_WRITE, DonationReceipt.class, r.getId()));
  }

  static RestrictionView view(FundRestriction r) {
    AnalyticAccount a = r.getAnalyticAccount();
    return new RestrictionView(r.getId(), r.getVersion(), r.getCode(), r.getName(), a.getId(), a.getCode(), a.getName(),
        Boolean.TRUE.equals(r.getActive()));
  }

  static DeliverableView view(GrantDeliverable d) {
    return new DeliverableView(d.getId(), d.getVersion(), d.getTitle(), d.getDueDate(),
        name(d.getStatusSelect(), "PENDING", "SUBMITTED", "ACCEPTED"), d.getSubmittedOn());
  }

  public record VersionOnly(Integer version) {}
  public record CreateDonor(Long partnerId, String donorType, Boolean anonymous) {}
  public record SaveSensitive(Integer version, BigDecimal givingCapacity, String contactPreference, String relationshipNote) {}
  public record RecordActivity(Integer version, String kind, String occurredOn, String subject) {}
  public record CreateFundingOpportunity(
      String reference, Long donorId, String title, String purpose, String kind, BigDecimal proposedAmount, String currencyCode,
      String deadline, Long campaignId) {}
  public record ChangeStage(Integer version, String stage) {}
  public record Approve(
      Integer version, BigDecimal committedAmount, String approvedOn, String periodEnd, Boolean restricted,
      String restrictionPurpose, String agreementReference) {}
  public record Renew(Integer version, String reference, String deadline) {}
  public record Schedule(Integer version, String dueDate, BigDecimal amount) {}
  public record RecordCollection(Integer version, BigDecimal amount, String receivedOn, String bankReference) {}
  public record VoidCollection(Integer version, String reason) {}
  public record AddDeliverable(Integer version, String title, String dueDate) {}
  public record CampaignView(Long id, String name) {}
  public record DonorView(
      Long id, Integer version, Long partnerId, String name, boolean anonymous, String donorType, boolean managedByMe,
      String managerName, boolean sensitiveOnFile, long openOpportunities) {}
  public record MoneyTotals(
      String currency, BigDecimal proposed, BigDecimal committed, BigDecimal scheduled, BigDecimal collected,
      BigDecimal outstanding, BigDecimal restrictedCommitted) {}
  public record Donor360View(DonorView donor, List<MoneyTotals> totals) {}
  public record FundingOpportunityView(
      Long id, Integer version, String reference, Long donorId, String donorName, String title, String purpose, String kind,
      String stage, BigDecimal proposedAmount, String currency, LocalDate deadline, Long campaignId, String campaignName,
      String renewalOf, Long commitmentId, boolean archived, boolean managedByMe) {}
  public record CommitmentView(
      Long id, Integer version, Long opportunityId, String reference, String title, String donorName, String currency,
      BigDecimal committed, BigDecimal scheduled, BigDecimal collected, BigDecimal outstanding, BigDecimal unscheduled,
      boolean restricted, String restrictionPurpose, String agreementReference, LocalDate approvedOn, LocalDate periodEnd,
      long pendingDeliverables, String allocationStatus, Long fundRestrictionId, String fundRestrictionCode,
      String fundRestrictionName, String analyticAccount, String accountingStatus, boolean canAllocate, boolean canIssueReceipts,
      boolean managedByMe) {}
  public record InstallmentView(
      Long id, Integer version, Integer sequence, LocalDate dueDate, BigDecimal amount, BigDecimal collected, String status) {}
  public record InstallmentStatusView(
      Long id, Long commitmentId, String reference, String donorName, Integer sequence, LocalDate dueDate, BigDecimal amount,
      BigDecimal collected, String currency, String status) {}
  /** receiptStatus: ISSUED, NOT_ISSUED or NOT_ALLOWED (voided); allocationStatus: NOT_RESTRICTED, ALLOCATED or PENDING_ALLOCATION. */
  public record CollectionView(
      Long id, Integer version, BigDecimal amount, LocalDate receivedOn, String status, String voidReason, String recordedBy,
      String receiptStatus, Long receiptId, String receiptNumber, long voidedReceipts, boolean canIssueReceipt,
      String allocationStatus, String analyticAccount) {}
  public record ReceiptView(
      Long id, Integer version, String number, String status, Long collectionId, Long opportunityId, String reference,
      String title, String donorName, BigDecimal amount, String currency, LocalDate receivedOn, LocalDate issuedOn,
      String issuedBy, String restrictedTo, String voidReason, LocalDateTime voidedAt, String replacesNumber, boolean canVoid) {}
  public record Allocate(Integer version, Long restrictionId) {}
  public record SaveRestriction(Integer version, String code, String name, Long analyticAccountId, Boolean active) {}
  public record RestrictionView(
      Long id, Integer version, String code, String name, Long analyticAccountId, String analyticAccountCode,
      String analyticAccountName, boolean active) {}
  public record AnalyticAccountView(Long id, String code, String name) {}
  /** One restriction (null id: restricted funding not yet allocated) in one currency; spending is not tracked here. */
  public record RestrictedFundView(
      Long restrictionId, String code, String name, String analyticAccountCode, String analyticAccountName, String currency,
      BigDecimal committed, BigDecimal collected, long commitments, boolean allocated) {}
  public record DeliverableView(Long id, Integer version, String title, LocalDate dueDate, String status, LocalDate submittedOn) {}
  public record DonorTimelineEvent(LocalDateTime at, String kind, String label, String actorName) {}
  public record OverviewView(
      List<MoneyTotals> totals, Map<String, Long> stages, List<InstallmentStatusView> attention, long opportunities) {}
}
