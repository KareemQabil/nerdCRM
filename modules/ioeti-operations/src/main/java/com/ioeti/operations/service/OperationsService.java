package com.ioeti.operations.service;

import com.ioeti.core.notify.Notifier;
import com.axelor.apps.contract.db.Contract;
import com.axelor.apps.contract.db.repo.ContractRepository;
import com.axelor.apps.project.db.Project;
import com.axelor.apps.project.db.ProjectStatus;
import com.axelor.apps.project.db.ProjectTask;
import com.axelor.apps.project.db.TaskStatus;
import com.axelor.apps.project.db.repo.ProjectRepository;
import com.axelor.auth.AuthUtils;
import com.axelor.auth.db.User;
import com.axelor.db.JPA;
import com.axelor.db.Model;
import com.axelor.db.Query;
import com.axelor.inject.Beans;
import com.axelor.team.db.Team;
import com.google.inject.persist.Transactional;
import com.ioeti.businessline.db.BusinessLine;
import com.ioeti.core.api.ApiException;
import com.ioeti.core.api.Locks;
import com.ioeti.operations.db.HandoverEvent;
import com.ioeti.operations.db.HandoverItem;
import com.ioeti.operations.db.HandoverRequest;
import com.ioeti.operations.db.HandoverRequirement;
import com.ioeti.operations.db.repo.HandoverEventRepository;
import com.ioeti.operations.db.repo.HandoverRequestRepository;
import jakarta.persistence.LockModeType;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.List;

/**
 * Handover from sales to operations, and the engagement it creates.
 *
 * <ul>
 *   <li>A handover is requested for an <b>active</b> contract only. Activation (signature) is D-11, so
 *       in production this stays closed until that policy is signed.
 *   <li>One open or accepted handover per contract; a rejected one can be followed by a new request.
 *   <li>The checklist is copied from the business line's configured requirements at submission; a
 *       business line without a configured checklist cannot hand over (fail closed).
 *   <li>Operations accepts only when every required item is done; acceptance creates exactly one
 *       native {@link Project} in the same transaction, so there is no orphan project and no second
 *       engagement for the same handover (unique link on the project).
 *   <li>Every step is appended to {@link HandoverEvent}; events are never changed.
 * </ul>
 *
 * <p>Writers lock the handover row ({@code PESSIMISTIC_FORCE_INCREMENT}); requests lock the contract,
 * so concurrent writers serialize and the second sees 409.
 */
public class OperationsService {

  /** In-app notice about a handover (Wave 7b); dropped when no inbox module is installed. */
  private static void notice(User recipient, String kind, HandoverRequest handover) {
    Contract contract = handover.getContract();
    Beans.get(Notifier.class).notify(recipient, kind, "HANDOVER", handover.getId(),
        "Handover " + (contract == null ? handover.getId() : contract.getContractId()));
  }

  public static boolean isOpen(int status) {
    return status == HandoverRequestRepository.STATUS_SUBMITTED || status == HandoverRequestRepository.STATUS_REWORK_REQUESTED;
  }

  @Transactional(rollbackOn = {Exception.class})
  public <T extends Model> T create(T record) {
    return JPA.save(record);
  }

  @Transactional(rollbackOn = {Exception.class})
  public HandoverRequest request(Contract contract, BusinessLine line) {
    JPA.em().lock(contract, LockModeType.PESSIMISTIC_FORCE_INCREMENT);
    if (!Integer.valueOf(ContractRepository.ACTIVE_CONTRACT).equals(contract.getStatusSelect())) {
      throw new ApiException(422, "CONTRACT_NOT_ACTIVE", "Only an active (signed) contract can be handed over.", null);
    }
    long existing = Query.of(HandoverRequest.class)
        .filter("self.contract = ?1 AND self.statusSelect <> ?2", contract, HandoverRequestRepository.STATUS_REJECTED).count();
    if (existing > 0) {
      throw new ApiException(409, "HANDOVER_EXISTS", "This contract already has an open or accepted handover.", null);
    }
    List<HandoverRequirement> requirements = Query.of(HandoverRequirement.class)
        .filter("self.businessLine = ?1 AND self.active = true", line).order("sequence").order("id").fetch();
    if (requirements.isEmpty()) {
      throw new ApiException(422, "CHECKLIST_NOT_CONFIGURED",
          "This business line has no handover checklist yet; an administrator configures it first.", null);
    }
    HandoverRequest handover = new HandoverRequest();
    handover.setContract(contract);
    handover.setBusinessLine(line);
    handover.setStatusSelect(HandoverRequestRepository.STATUS_SUBMITTED);
    handover.setRequestedBy(AuthUtils.getUser());
    handover.setSubmittedAt(LocalDateTime.now());
    JPA.save(handover);
    for (HandoverRequirement requirement : requirements) {
      HandoverItem item = new HandoverItem();
      item.setHandover(handover);
      item.setTitle(requirement.getTitle());
      item.setMandatory(Boolean.TRUE.equals(requirement.getMandatory()));
      item.setSequence(requirement.getSequence());
      item.setDone(false);
      JPA.save(item);
    }
    event(handover, HandoverEventRepository.KIND_SUBMITTED, null, null, null, null);
    return handover;
  }

  @Transactional(rollbackOn = {Exception.class})
  public HandoverItem complete(HandoverItem item, String evidenceReference) {
    HandoverRequest handover = item.getHandover();
    JPA.em().lock(handover, LockModeType.PESSIMISTIC_FORCE_INCREMENT);
    if (!isOpen(handover.getStatusSelect())) {
      throw new ApiException(422, "HANDOVER_STATE", "The checklist of a decided handover cannot change.", null);
    }
    if (Boolean.TRUE.equals(item.getDone())) return item;
    item.setDone(true);
    item.setDoneBy(AuthUtils.getUser());
    item.setDoneAt(LocalDateTime.now());
    item.setEvidenceReference(evidenceReference);
    event(handover, HandoverEventRepository.KIND_ITEM_DONE, null, null, null, item.getTitle());
    return JPA.save(item);
  }

  @Transactional(rollbackOn = {Exception.class})
  public HandoverRequest rework(HandoverRequest handover, int reason) {
    JPA.em().lock(handover, LockModeType.PESSIMISTIC_FORCE_INCREMENT);
    if (handover.getStatusSelect() != HandoverRequestRepository.STATUS_SUBMITTED) {
      throw new ApiException(422, "HANDOVER_STATE", "Only a submitted handover can be sent back for rework.", null);
    }
    handover.setStatusSelect(HandoverRequestRepository.STATUS_REWORK_REQUESTED);
    handover.setReviewedBy(AuthUtils.getUser());
    event(handover, HandoverEventRepository.KIND_REWORK_REQUESTED, reason, null, null, null);
    notice(handover.getRequestedBy(), "HANDOVER_REWORK", handover);
    return JPA.save(handover);
  }

  @Transactional(rollbackOn = {Exception.class})
  public HandoverRequest resubmit(HandoverRequest handover) {
    JPA.em().lock(handover, LockModeType.PESSIMISTIC_FORCE_INCREMENT);
    if (handover.getStatusSelect() != HandoverRequestRepository.STATUS_REWORK_REQUESTED) {
      throw new ApiException(422, "HANDOVER_STATE", "Only a handover sent back for rework can be resubmitted.", null);
    }
    handover.setStatusSelect(HandoverRequestRepository.STATUS_SUBMITTED);
    handover.setSubmittedAt(LocalDateTime.now());
    event(handover, HandoverEventRepository.KIND_RESUBMITTED, null, null, null, null);
    return JPA.save(handover);
  }

  @Transactional(rollbackOn = {Exception.class})
  public HandoverRequest reject(HandoverRequest handover, int reason) {
    JPA.em().lock(handover, LockModeType.PESSIMISTIC_FORCE_INCREMENT);
    if (handover.getStatusSelect() != HandoverRequestRepository.STATUS_SUBMITTED) {
      throw new ApiException(422, "HANDOVER_STATE", "Only a submitted handover can be rejected.", null);
    }
    handover.setStatusSelect(HandoverRequestRepository.STATUS_REJECTED);
    handover.setReviewedBy(AuthUtils.getUser());
    handover.setDecidedAt(LocalDateTime.now());
    event(handover, HandoverEventRepository.KIND_REJECTED, reason, null, null, null);
    notice(handover.getRequestedBy(), "HANDOVER_REJECTED", handover);
    return JPA.save(handover);
  }

  /** Accepts the handover and creates its engagement (a native project) in the same transaction. */
  @Transactional(rollbackOn = {Exception.class})
  public Project accept(HandoverRequest handover, User lead, Team team, LocalDate start) {
    JPA.em().lock(handover, LockModeType.PESSIMISTIC_FORCE_INCREMENT);
    if (handover.getStatusSelect() != HandoverRequestRepository.STATUS_SUBMITTED) {
      throw new ApiException(422, "HANDOVER_STATE", "Only a submitted handover can be accepted.", null);
    }
    long missing = Query.of(HandoverItem.class)
        .filter("self.handover = ?1 AND self.mandatory = true AND (self.done IS NULL OR self.done = false)", handover).count();
    if (missing > 0) {
      throw new ApiException(422, "CHECKLIST_INCOMPLETE", "Every required item must be done before acceptance.", null);
    }
    if (Query.of(Project.class).filter("self.ioetiHandover = ?1", handover).count() > 0) {
      throw new ApiException(409, "ENGAGEMENT_EXISTS", "This handover already has an engagement.", null);
    }
    Contract contract = handover.getContract();
    Project project = new Project();
    project.setName(contract.getName() == null ? "Engagement " + contract.getContractId() : contract.getName());
    project.setCode("ENG-H" + handover.getId());
    project.setClientPartner(contract.getPartner());
    project.setCompany(contract.getCompany());
    project.setAssignedTo(lead);
    project.setTeam(team);
    project.setFromDate(start.atStartOfDay());
    project.setIoetiHandover(handover);
    ProjectStatus status = Query.of(ProjectStatus.class).order("sequence").order("id").fetchOne();
    if (status != null) project.setProjectStatus(status);
    project = Beans.get(ProjectRepository.class).save(project);
    handover.setStatusSelect(HandoverRequestRepository.STATUS_ACCEPTED);
    handover.setReviewedBy(AuthUtils.getUser());
    handover.setOperationsLead(lead);
    handover.setTeam(team);
    handover.setDecidedAt(LocalDateTime.now());
    handover.setEngagement(project);
    event(handover, HandoverEventRepository.KIND_ACCEPTED, null, null, lead, null);
    event(handover, HandoverEventRepository.KIND_ENGAGEMENT_CREATED, null, null, null, project.getCode());
    JPA.save(handover);
    notice(handover.getRequestedBy(), "HANDOVER_ACCEPTED", handover);
    Beans.get(Notifier.class).notify(lead, "ENGAGEMENT_ASSIGNED", "ENGAGEMENT", project.getId(), "Engagement " + project.getCode());
    return project;
  }

  @Transactional(rollbackOn = {Exception.class})
  public Project transferOwnership(Project project, User to) {
    JPA.em().lock(project, LockModeType.PESSIMISTIC_FORCE_INCREMENT);
    User from = project.getAssignedTo();
    if (to.equals(from)) {
      throw new ApiException(422, "SAME_OWNER", "This person already leads the engagement.", null);
    }
    project.setAssignedTo(to);
    HandoverRequest handover = project.getIoetiHandover();
    handover.setOperationsLead(to);
    event(handover, HandoverEventRepository.KIND_OWNER_CHANGED, null, from, to, null);
    JPA.save(handover);
    return JPA.save(project);
  }

  @Transactional(rollbackOn = {Exception.class})
  public ProjectTask addTask(Project project, String name, LocalDate due, User assignee) {
    JPA.em().lock(project, LockModeType.PESSIMISTIC_FORCE_INCREMENT);
    ProjectTask task = new ProjectTask();
    task.setProject(project);
    task.setName(name);
    task.setTaskDate(LocalDate.now());
    task.setTaskEndDate(due);
    task.setAssignedTo(assignee);
    TaskStatus open = Query.of(TaskStatus.class).filter("self.isCompleted IS NULL OR self.isCompleted = false")
        .order("sequence").order("id").fetchOne();
    if (open != null) task.setStatus(open);
    task.setProgress(BigDecimal.ZERO);
    return JPA.save(task);
  }

  @Transactional(rollbackOn = {Exception.class})
  public ProjectTask completeTask(ProjectTask task) {
    Locks.parent(task.getProject());
    if (isDone(task)) {
      throw new ApiException(422, "TASK_DONE", "This task is already done.", null);
    }
    TaskStatus done = Query.of(TaskStatus.class).filter("self.isCompleted = true").order("sequence").order("id").fetchOne();
    if (done != null) task.setStatus(done);
    task.setProgress(new BigDecimal("100"));
    return JPA.save(task);
  }

  public static boolean isDone(ProjectTask task) {
    return (task.getStatus() != null && Boolean.TRUE.equals(task.getStatus().getIsCompleted()))
        || (task.getProgress() != null && task.getProgress().compareTo(new BigDecimal("100")) >= 0);
  }

  private void event(HandoverRequest handover, int kind, Integer reason, User from, User to, String itemTitle) {
    HandoverEvent event = new HandoverEvent();
    event.setHandover(handover);
    event.setKindSelect(kind);
    event.setReasonSelect(reason);
    event.setActor(AuthUtils.getUser());
    event.setOccurredAt(LocalDateTime.now());
    event.setFromUser(from);
    event.setToUser(to);
    event.setItemTitle(itemTitle);
    JPA.save(event);
  }
}
