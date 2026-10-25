package com.ioeti.commercial.rest;

import com.axelor.apps.base.db.Company;
import com.axelor.apps.base.db.Partner;
import com.axelor.apps.contract.db.Contract;
import com.axelor.apps.contract.db.ContractLine;
import com.axelor.apps.contract.db.repo.ContractRepository;
import com.axelor.apps.crm.db.Opportunity;
import com.axelor.apps.sale.db.SaleOrder;
import com.axelor.auth.AuthUtils;
import com.axelor.db.JPA;
import com.axelor.db.JpaSecurity;
import com.axelor.inject.Beans;
import com.axelor.rpc.filter.Filter;
import com.axelor.rpc.filter.JPQLFilter;
import com.axelor.utils.api.ConflictChecker;
import com.axelor.utils.api.ResponseConstructor;
import com.axelor.utils.api.SecurityCheck;
import com.ioeti.commercial.service.ContractDraftService;
import com.ioeti.commercial.service.ContractLinesService;
import com.axelor.apps.base.service.app.AppBaseService;
import com.ioeti.commercial.service.QuoteApprovalService;
import com.ioeti.commercial.service.QuoteService;
import com.ioeti.core.policy.PolicyService;
import com.ioeti.core.api.ApiException;
import com.ioeti.core.api.IoetiEndpoint;
import com.ioeti.core.api.NativeCommands;
import com.ioeti.core.api.RecordAccess;
import io.swagger.v3.oas.annotations.Operation;
import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.PathParam;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.QueryParam;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import java.math.BigDecimal;
import java.util.List;

/**
 * Customer contracts of opportunities (Wave 3), on native AOS {@code Contract}.
 *
 * <p>Drafts can be created and filled from a quotation. D-11 (signed 2026-10-25): a holder of the role the business
 * line's {@code sales.contract-signatory} policy names activates a contract on its uploaded signature evidence
 * ({@code POST /ws/ioeti/workspace/contracts/{id}/activate}, where the documents module is reachable); the view says
 * whether the caller may. The operations handover of an active contract is {@code /ws/ioeti/operations/handovers}.
 */
@Path("/ioeti/contracts")
@Produces(MediaType.APPLICATION_JSON)
public class ContractRestController {

  @GET
  @Operation(summary = "Contracts of an opportunity the caller may read", tags = {"IOETI contracts"})
  @IoetiEndpoint
  public Response list(@QueryParam("opportunityId") Long opportunityId) {
    new SecurityCheck().readAccess(Contract.class).check();
    Opportunity opportunity = RecordAccess.readable(Opportunity.class, opportunityId);
    Filter ofOpportunity = new JPQLFilter("self.opportunity.id = " + opportunity.getId());
    Filter security = Beans.get(JpaSecurity.class).getFilter(JpaSecurity.CAN_READ, Contract.class);
    Filter condition = security == null ? ofOpportunity : Filter.and(security, ofOpportunity);
    List<ContractView> records = condition.build(Contract.class).order("-id").fetch(20).stream()
        .map(ContractRestController::view).toList();
    return ResponseConstructor.build(Response.Status.OK, "Contracts", records);
  }

  @GET
  @Path("/{id}")
  @Operation(summary = "Read one contract with record-level permission checks", tags = {"IOETI contracts"})
  @IoetiEndpoint
  public Response get(@PathParam("id") Long id) {
    return ResponseConstructor.build(
        Response.Status.OK, "Contract", view(RecordAccess.readable(Contract.class, id)));
  }

  @POST
  @Consumes(MediaType.APPLICATION_JSON)
  @Operation(summary = "Create the draft customer contract of an opportunity (native AOS service)", tags = {"IOETI contracts"})
  @IoetiEndpoint
  public Response create(CreateContract command) {
    if (command == null || command.opportunityVersion() == null) {
      throw ApiException.badRequest("Opportunity version is required.");
    }
    int contractType = contractType(command.contractType());
    new SecurityCheck().createAccess(Contract.class).check();
    Opportunity opportunity = RecordAccess.writable(Opportunity.class, command.opportunityId());
    ConflictChecker.checkVersion(opportunity, command.opportunityVersion());
    if (opportunity.getPartner() == null) {
      throw ApiException.invalidField(
          "opportunityId", "ACCOUNT_REQUIRED", "Link the opportunity to an account before drafting a contract.");
    }
    Company company = Beans.get(QuoteService.class).quotingCompany(opportunity, AuthUtils.getUser())
        .orElseThrow(() -> new ApiException(422, "SETUP_REQUIRED", "No company is configured for contracts.", null));
    Contract[] created = new Contract[1];
    NativeCommands.run(
        () -> created[0] = Beans.get(ContractDraftService.class).createDraft(opportunity, company, contractType),
        "CONTRACT_REJECTED", "The contract cannot be created this way.");
    return ResponseConstructor.build(Response.Status.CREATED, "Draft contract created", view(created[0]));
  }

  @POST
  @Path("/{id}/lines-from-quote")
  @Consumes(MediaType.APPLICATION_JSON)
  @Operation(summary = "Fill a draft contract with the lines of a quotation of the same opportunity", tags = {"IOETI contracts"})
  @IoetiEndpoint
  public Response linesFromQuote(@PathParam("id") Long id, FillFromQuote command) {
    if (command == null || command.version() == null) {
      throw ApiException.badRequest("Record version is required.");
    }
    new SecurityCheck().createAccess(ContractLine.class).check();
    Contract contract = RecordAccess.writable(Contract.class, id);
    ConflictChecker.checkVersion(contract, command.version());
    if (!Integer.valueOf(ContractRepository.DRAFT_CONTRACT).equals(contract.getStatusSelect())) {
      throw new ApiException(422, "CONTRACT_NOT_DRAFT", "Only a draft contract can be changed.", null);
    }
    SaleOrder quote = quoteOfSameOpportunity(contract, command.quoteId());
    if (quote.getSaleOrderLineList() == null
        || quote.getSaleOrderLineList().stream().noneMatch(l -> l.getProduct() != null)) {
      throw ApiException.invalidField("quoteId", "QUOTE_EMPTY", "The quotation has no product lines.");
    }
    NativeCommands.run(
        () -> Beans.get(ContractLinesService.class).fillFromQuote(contract, quote),
        "CONTRACT_REJECTED", "The contract cannot be changed this way.");
    return ResponseConstructor.build(Response.Status.CREATED, "Contract lines added", view(contract));
  }

  /** Unknown, unreadable and other opportunities' quotations are refused identically (no oracle). */
  private static SaleOrder quoteOfSameOpportunity(Contract contract, Long quoteId) {
    JpaSecurity security = Beans.get(JpaSecurity.class);
    SaleOrder quote = quoteId == null || quoteId <= 0 ? null : JPA.find(SaleOrder.class, quoteId);
    if (quote == null
        || !security.isPermitted(JpaSecurity.CAN_READ, SaleOrder.class, quoteId)
        || quote.getOpportunity() == null || contract.getOpportunity() == null
        || !quote.getOpportunity().getId().equals(contract.getOpportunity().getId())) {
      throw ApiException.invalidField(
          "quoteId", "UNAVAILABLE", "Choose a quotation of this contract's opportunity.");
    }
    return quote;
  }

  static int contractType(String value) {
    if ("BILLING".equals(value)) return 1;
    if ("FRAMEWORK".equals(value)) return 2;
    throw ApiException.invalidField("contractType", "CHOICE", "Choose BILLING or FRAMEWORK.");
  }

  static String status(Integer statusSelect) {
    if (statusSelect == null) return null;
    return switch (statusSelect) {
      case ContractRepository.DRAFT_CONTRACT -> "DRAFT";
      case ContractRepository.ACTIVE_CONTRACT -> "ACTIVE";
      case ContractRepository.CLOSED_CONTRACT -> "CLOSED";
      default -> "OTHER";
    };
  }

  static ContractView view(Contract contract) {
    JpaSecurity security = Beans.get(JpaSecurity.class);
    Opportunity opportunity = contract.getOpportunity();
    Partner account = contract.getPartner();
    boolean canReadAccount = account != null
        && security.isPermitted(JpaSecurity.CAN_READ, Partner.class, account.getId());
    Integer type = contract.getContractTypeSelect();
    List<ContractLine> source = contract.getCurrentContractVersion() == null
        || contract.getCurrentContractVersion().getContractLineList() == null
        ? List.of() : contract.getCurrentContractVersion().getContractLineList();
    List<ContractLineView> lines = source.stream().map(l -> new ContractLineView(
        l.getId(), l.getProduct() == null ? null : l.getProduct().getCode(), l.getProductName(),
        l.getQty(), l.getPrice(), l.getExTaxTotal())).toList();
    BigDecimal total = source.stream().map(ContractLine::getExTaxTotal)
        .filter(java.util.Objects::nonNull).reduce(BigDecimal.ZERO, BigDecimal::add);
    return new ContractView(
        contract.getId(), contract.getVersion(), contract.getContractId(), contract.getName(),
        status(contract.getStatusSelect()),
        type == null ? null : type == 1 ? "BILLING" : type == 2 ? "FRAMEWORK" : null,
        opportunity != null && security.isPermitted(JpaSecurity.CAN_READ, Opportunity.class, opportunity.getId())
            ? opportunity.getId() : null,
        canReadAccount ? account.getId() : null,
        canReadAccount ? account.getName() : null,
        contract.getCurrency() == null ? null : contract.getCurrency().getCode(),
        activation(contract).status(),
        sourceQuote(contract, security),
        lines,
        total,
        activation(contract));
  }

  /**
   * D-11: an active contract shows its signature record; a draft shows whether the caller may activate it (the
   * signatory policy of its business line, and whether they hold its role).
   */
  static ActivationView activation(Contract contract) {
    if (Integer.valueOf(ContractRepository.ACTIVE_CONTRACT).equals(contract.getStatusSelect())
        || Integer.valueOf(ContractRepository.CLOSED_CONTRACT).equals(contract.getStatusSelect())) {
      return new ActivationView(contract.getIoetiSignatureDocument() == null ? "ACTIVE" : "SIGNED", null, contract.getIoetiSignedOn(),
          contract.getIoetiActivatedBy() == null ? null : contract.getIoetiActivatedBy().getName(), contract.getIoetiActivatedAt(),
          contract.getIoetiSignatureDocument(), contract.getIoetiSignatureRevision());
    }
    String line = contract.getOpportunity() == null || contract.getOpportunity().getIoetiBusinessLine() == null ? null
        : contract.getOpportunity().getIoetiBusinessLine().getCode();
    java.util.Optional<PolicyService.Applied> policy = Beans.get(PolicyService.class)
        .current("sales.contract-signatory", line, Beans.get(AppBaseService.class).getTodayDate(contract.getCompany()));
    if (policy.isEmpty()) return new ActivationView("POLICY_NOT_SET", null, null, null, null, null, null);
    String signatory = policy.get().value().path("signatory").asText();
    return new ActivationView(QuoteApprovalService.holds(AuthUtils.getUser(), signatory) ? "READY" : "NOT_SIGNATORY", signatory,
        null, null, null, null, null);
  }

  private static Long sourceQuote(Contract contract, JpaSecurity security) {
    SaleOrder quote = contract.getIoetiSourceQuote();
    return quote != null && security.isPermitted(JpaSecurity.CAN_READ, SaleOrder.class, quote.getId())
        ? quote.getId() : null;
  }

  public record CreateContract(Long opportunityId, Integer opportunityVersion, String contractType) {}
  public record FillFromQuote(Integer version, Long quoteId) {}
  public record ContractLineView(
      Long id, String productCode, String name, BigDecimal quantity, BigDecimal unitPriceBeforeTax,
      BigDecimal totalBeforeTax) {}
  /** Amounts are before tax: taxes are policy D-06. */
  public record ContractView(
      Long id, Integer version, String reference, String name, String status, String contractType,
      Long opportunityId, Long accountId, String accountName, String currency, String activationStatus,
      Long sourceQuoteId, List<ContractLineView> lines, BigDecimal totalBeforeTax, ActivationView activation) {}
  /**
   * D-11: SIGNED (activated on signature evidence: when signed, who activated, which document revision), ACTIVE (activated
   * before D-11), POLICY_NOT_SET, NOT_SIGNATORY or READY (the caller may activate it; the signatory role is named).
   */
  public record ActivationView(
      String status, String signatory, java.time.LocalDate signedOn, String activatedBy, java.time.LocalDateTime activatedAt,
      Long documentId, Integer documentRevision) {}
}
