package com.ioeti.admin.service;

import com.axelor.apps.base.db.Source;
import com.axelor.apps.crm.db.LostReason;
import com.axelor.apps.crm.db.OpportunityStatus;
import com.axelor.apps.marketing.db.CampaignType;
import com.axelor.db.JPA;
import com.axelor.db.Model;
import com.axelor.db.Query;
import com.axelor.inject.Beans;
import com.axelor.studio.db.AppCrm;
import com.google.inject.persist.Transactional;
import com.ioeti.core.api.ApiException;
import jakarta.persistence.PersistenceException;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import java.util.Objects;

/**
 * The reference lists people pick from every day, managed from the platform (journeys plan, phase 5,
 * brought forward): lost reasons, lead sources, opportunity stages and campaign types. These are native records; the
 * values are the company's own, so none are shipped. A value in use cannot be deleted (it is renamed
 * instead); the configured won, lost and default stages and the sales-proposition stage cannot be
 * deleted. Every change goes to the admin audit trail.
 */
public class ReferenceLists {

  public enum Kind {
    LOST_REASON("lost-reasons", "LOST_REASON"),
    SOURCE("sources", "SOURCE"),
    OPPORTUNITY_STAGE("opportunity-stages", "OPPORTUNITY_STAGE"),
    CAMPAIGN_TYPE("campaign-types", "CAMPAIGN_TYPE");

    public final String path;
    public final String subject;

    Kind(String path, String subject) {
      this.path = path;
      this.subject = subject;
    }

    public static Kind of(String path) {
      for (Kind kind : values()) if (kind.path.equals(path)) return kind;
      throw ApiException.notFound();
    }
  }

  /** One value: its role is WON, LOST, DEFAULT or PROPOSITION for a protected stage, otherwise null. */
  public record Entry(Long id, Integer version, String name, Integer sequence, String role, long uses) {}

  public List<Entry> list(Kind kind) {
    List<Entry> rows = new ArrayList<>();
    for (Model value : Query.of(type(kind)).fetch(500)) rows.add(entry(kind, value));
    rows.sort(kind == Kind.OPPORTUNITY_STAGE
        ? Comparator.comparing((Entry e) -> e.sequence() == null ? Integer.MAX_VALUE : e.sequence()).thenComparing(Entry::id)
        : Comparator.comparing((Entry e) -> e.name().toLowerCase(Locale.ROOT)));
    return rows;
  }

  @Transactional(rollbackOn = {Exception.class})
  public Entry add(Kind kind, String rawName) {
    String name = AdminService.text("name", rawName, 255, true);
    unique(kind, name, null);
    Model value = switch (kind) {
      case LOST_REASON -> { LostReason r = new LostReason(); r.setName(name); yield r; }
      case SOURCE -> { Source s = new Source(); s.setName(name); yield s; }
      case CAMPAIGN_TYPE -> { CampaignType t = new CampaignType(); t.setName(name); yield t; }
      case OPPORTUNITY_STAGE -> {
        OpportunityStatus s = new OpportunityStatus();
        s.setName(name);
        s.setSequence(nextOpenSequence());
        yield s;
      }
    };
    Model saved = JPA.save(value);
    audit().audit(kind.subject + "_ADDED", kind.subject, saved.getId(), name, List.of("name"));
    return entry(kind, saved);
  }

  @Transactional(rollbackOn = {Exception.class})
  public Entry rename(Kind kind, Long id, Integer version, String rawName) {
    Model value = versioned(kind, id, version);
    String name = AdminService.text("name", rawName, 255, true);
    unique(kind, name, id);
    String before = nameOf(value);
    switch (kind) {
      case LOST_REASON -> ((LostReason) value).setName(name);
      case SOURCE -> ((Source) value).setName(name);
      case CAMPAIGN_TYPE -> ((CampaignType) value).setName(name);
      case OPPORTUNITY_STAGE -> ((OpportunityStatus) value).setName(name);
    }
    Model saved = JPA.save(value);
    audit().audit(kind.subject + "_RENAMED", kind.subject, id, name, List.of("name=" + before + "→" + name));
    return entry(kind, saved);
  }

  @Transactional(rollbackOn = {Exception.class})
  public void delete(Kind kind, Long id, Integer version) {
    Model value = versioned(kind, id, version);
    Entry entry = entry(kind, value);
    if (entry.role() != null) throw new ApiException(422, "PROTECTED", "This stage is part of the CRM configuration and cannot be deleted.", null);
    if (entry.uses() > 0) throw new ApiException(409, "IN_USE", "This value is in use; rename it instead.", null);
    try {
      JPA.remove(value);
      JPA.flush();
    } catch (PersistenceException e) {
      // referenced from somewhere the usage count does not look (another module): keep it
      throw new ApiException(409, "IN_USE", "This value is in use; rename it instead.", null);
    }
    audit().audit(kind.subject + "_DELETED", kind.subject, id, entry.name(), List.of("deleted"));
  }

  /** Puts the open stages in the given order; the won and lost stages stay after them. */
  @Transactional(rollbackOn = {Exception.class})
  public List<Entry> order(List<Long> ids) {
    List<OpportunityStatus> stages = Query.of(OpportunityStatus.class).fetch(500);
    List<OpportunityStatus> open = stages.stream().filter(s -> !closed(s)).toList();
    if (ids == null || ids.size() != open.size() || !ids.containsAll(open.stream().map(OpportunityStatus::getId).toList())) {
      throw ApiException.invalidField("ids", "INCOMPLETE", "Send every open stage exactly once.");
    }
    int sequence = 0;
    for (Long id : ids) {
      OpportunityStatus stage = open.stream().filter(s -> s.getId().equals(id)).findFirst().orElseThrow();
      stage.setSequence(sequence += 10);
      JPA.save(stage);
    }
    for (OpportunityStatus stage : stages) {
      if (closed(stage)) { stage.setSequence(sequence += 10); JPA.save(stage); }
    }
    audit().audit("OPPORTUNITY_STAGE_ORDERED", Kind.OPPORTUNITY_STAGE.subject, null, null,
        List.of("order=" + String.join(", ", ids.stream().map(String::valueOf).toList())));
    return list(Kind.OPPORTUNITY_STAGE);
  }

  // --- helpers -----------------------------------------------------------------------------------

  private static AdminService audit() { return Beans.get(AdminService.class); }

  @SuppressWarnings("unchecked")
  private static Class<Model> type(Kind kind) {
    return (Class<Model>) (Class<?>) switch (kind) {
      case LOST_REASON -> LostReason.class;
      case SOURCE -> Source.class;
      case CAMPAIGN_TYPE -> CampaignType.class;
      case OPPORTUNITY_STAGE -> OpportunityStatus.class;
    };
  }

  private static Model versioned(Kind kind, Long id, Integer version) {
    if (version == null) throw ApiException.badRequest("Record version is required.");
    Model value = id == null ? null : JPA.find(type(kind), id);
    if (value == null) throw ApiException.notFound();
    if (!Objects.equals(value.getVersion(), version)) throw ApiException.conflict();
    return value;
  }

  private static String nameOf(Model value) {
    if (value instanceof LostReason r) return r.getName();
    if (value instanceof Source s) return s.getName();
    if (value instanceof CampaignType t) return t.getName();
    return ((OpportunityStatus) value).getName();
  }

  private static void unique(Kind kind, String name, Long except) {
    boolean taken = Query.of(type(kind)).filter("LOWER(self.name) = ?1", name.toLowerCase(Locale.ROOT)).fetch(5).stream()
        .anyMatch(other -> !other.getId().equals(except));
    if (taken) throw ApiException.invalidField("name", "DUPLICATE", "This name is already in the list.");
  }

  private static long count(String jpql, Model value) {
    return JPA.em().createQuery(jpql, Long.class).setParameter(1, value).getSingleResult();
  }

  private static Entry entry(Kind kind, Model value) {
    return switch (kind) {
      case LOST_REASON -> new Entry(value.getId(), value.getVersion(), nameOf(value), null, null,
          count("SELECT COUNT(x) FROM Lead x WHERE x.lostReason = ?1", value)
              + count("SELECT COUNT(x) FROM Opportunity x WHERE x.lostReason = ?1", value));
      case SOURCE -> new Entry(value.getId(), value.getVersion(), nameOf(value), null, null,
          count("SELECT COUNT(x) FROM Lead x WHERE x.source = ?1", value)
              + count("SELECT COUNT(x) FROM Opportunity x WHERE x.source = ?1", value)
              + count("SELECT COUNT(x) FROM Partner x WHERE x.source = ?1", value));
      case CAMPAIGN_TYPE -> new Entry(value.getId(), value.getVersion(), nameOf(value), null, null,
          count("SELECT COUNT(x) FROM Campaign x WHERE x.campaignType = ?1", value));
      case OPPORTUNITY_STAGE -> {
        OpportunityStatus stage = (OpportunityStatus) value;
        yield new Entry(stage.getId(), stage.getVersion(), stage.getName(), stage.getSequence(), role(stage),
            count("SELECT COUNT(x) FROM Opportunity x WHERE x.opportunityStatus = ?1", value));
      }
    };
  }

  private static AppCrm appCrm() {
    return Query.of(AppCrm.class).fetchOne();
  }

  private static String role(OpportunityStatus stage) {
    AppCrm app = appCrm();
    if (app == null) return null;
    if (stage.equals(app.getClosedWinOpportunityStatus())) return "WON";
    if (stage.equals(app.getClosedLostOpportunityStatus())) return "LOST";
    if (stage.equals(app.getOpportunityDefaultStatus())) return "DEFAULT";
    if (stage.equals(app.getSalesPropositionStatus())) return "PROPOSITION";
    return null;
  }

  private static boolean closed(OpportunityStatus stage) {
    String role = role(stage);
    return "WON".equals(role) || "LOST".equals(role);
  }

  private static int nextOpenSequence() {
    // a new stage goes after the last open stage and before won and lost, which move up by ten
    List<OpportunityStatus> stages = Query.of(OpportunityStatus.class).order("sequence").fetch(500);
    int last = stages.stream().filter(s -> !closed(s)).mapToInt(s -> s.getSequence() == null ? 0 : s.getSequence()).max().orElse(0);
    for (OpportunityStatus stage : stages) {
      if (closed(stage) && stage.getSequence() != null && stage.getSequence() <= last + 10) {
        stage.setSequence(stage.getSequence() + 20);
        JPA.save(stage);
      }
    }
    return last + 10;
  }
}
