package com.ioeti.commercial.rest;

import com.axelor.apps.base.db.Company;
import com.axelor.apps.base.db.Partner;
import com.axelor.apps.contract.db.Contract;
import com.axelor.apps.contract.db.repo.ContractRepository;
import com.axelor.apps.crm.db.Opportunity;
import com.axelor.auth.AuthUtils;
import com.axelor.db.JpaSecurity;
import com.axelor.inject.Beans;
import com.axelor.rpc.filter.Filter;
import com.axelor.rpc.filter.JPQLFilter;
import com.axelor.utils.api.ConflictChecker;
import com.axelor.utils.api.ResponseConstructor;
import com.axelor.utils.api.SecurityCheck;
import com.ioeti.commercial.service.ContractDraftService;
import com.ioeti.commercial.service.QuoteService;
import com.ioeti.core.api.ApiException;
import com.ioeti.core.api.IoetiEndpoint;
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
import java.util.List;

/**
 * Customer contracts of opportunities (Wave 3), on native AOS {@code Contract}.
 *
 * <p>Drafts can be created. Activation (signature, legal approval, effective dates) is blocked until
 * IOETI's commercial and legal approval policy (D-11) is signed. So is the operations handover,
 * which needs an active contract.
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
  @Path("/{id}/activate")
  @Operation(summary = "Activate (sign) a contract: blocked until the approval and legal policy (D-11)", tags = {"IOETI contracts"})
  @IoetiEndpoint
  public Response activate(@PathParam("id") Long id) {
    RecordAccess.writable(Contract.class, id);
    throw ApiException.policyBlocked("D-11");
  }

  @POST
  @Path("/{id}/handover")
  @Operation(summary = "Hand an active contract over to operations: needs an active contract (D-11)", tags = {"IOETI contracts"})
  @IoetiEndpoint
  public Response handover(@PathParam("id") Long id) {
    Contract contract = RecordAccess.writable(Contract.class, id);
    if (!Integer.valueOf(ContractRepository.ACTIVE_CONTRACT).equals(contract.getStatusSelect())) {
      throw new ApiException(
          422, "CONTRACT_NOT_ACTIVE", "Only an active (signed) contract can be handed over to operations.", null);
    }
    throw ApiException.policyBlocked("D-11");
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
    return new ContractView(
        contract.getId(), contract.getVersion(), contract.getContractId(), contract.getName(),
        status(contract.getStatusSelect()),
        type == null ? null : type == 1 ? "BILLING" : type == 2 ? "FRAMEWORK" : null,
        opportunity != null && security.isPermitted(JpaSecurity.CAN_READ, Opportunity.class, opportunity.getId())
            ? opportunity.getId() : null,
        canReadAccount ? account.getId() : null,
        canReadAccount ? account.getName() : null,
        contract.getCurrency() == null ? null : contract.getCurrency().getCode(),
        "BLOCKED_BY_POLICY");
  }

  public record CreateContract(Long opportunityId, Integer opportunityVersion, String contractType) {}
  public record ContractView(
      Long id, Integer version, String reference, String name, String status, String contractType,
      Long opportunityId, Long accountId, String accountName, String currency, String activationStatus) {}
}
