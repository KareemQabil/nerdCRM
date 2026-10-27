package com.ioeti.marketing.service;

import com.axelor.apps.marketing.db.Campaign;
import com.axelor.apps.marketing.db.CampaignType;
import com.axelor.apps.marketing.db.repo.CampaignRepository;
import com.axelor.auth.db.User;
import com.axelor.inject.Beans;
import com.google.inject.persist.Transactional;
import com.ioeti.core.api.ApiException;
import java.time.LocalDateTime;
import java.util.Map;
import java.util.Set;

/**
 * Campaigns managed from the platform (capability map: marketing and campaigns) on the native
 * {@code Campaign}: its name, type, period, owner and summary, and its stage. Sending anything to
 * anyone from a campaign is external exposure (D-10) and is not offered here.
 */
public class CampaignService {

  public static final int DRAFT = 0, PLANNED = 1, STARTED = 2, SUSPENDED = 3, ENDED = 4;
  public static final String[] STAGES = {"DRAFT", "PLANNED", "STARTED", "SUSPENDED", "ENDED"};

  /** Where a campaign can go from each stage; an ended campaign stays ended. */
  static final Map<Integer, Set<Integer>> NEXT = Map.of(
      DRAFT, Set.of(PLANNED),
      PLANNED, Set.of(DRAFT, STARTED),
      STARTED, Set.of(SUSPENDED, ENDED),
      SUSPENDED, Set.of(STARTED, ENDED),
      ENDED, Set.of());

  public record Fields(String name, CampaignType type, LocalDateTime start, LocalDateTime end, User owner, String summary) {}

  public static int stage(Campaign campaign) {
    return campaign.getStageSelect() == null ? DRAFT : campaign.getStageSelect();
  }

  public static boolean allowed(int from, int to) {
    return NEXT.getOrDefault(from, Set.of()).contains(to);
  }

  @Transactional(rollbackOn = {Exception.class})
  public Campaign create(Fields f) {
    Campaign campaign = new Campaign();
    campaign.setStageSelect(DRAFT);
    apply(campaign, f, false, false, false, false);
    return Beans.get(CampaignRepository.class).save(campaign);
  }

  @Transactional(rollbackOn = {Exception.class})
  public Campaign update(Campaign campaign, Fields f, boolean clearType, boolean clearStart, boolean clearEnd, boolean clearSummary) {
    apply(campaign, f, clearType, clearStart, clearEnd, clearSummary);
    return Beans.get(CampaignRepository.class).save(campaign);
  }

  @Transactional(rollbackOn = {Exception.class})
  public Campaign move(Campaign campaign, int to) {
    int from = stage(campaign);
    if (from == to) return campaign;
    if (!allowed(from, to)) {
      throw new ApiException(422, "STAGE_NOT_ALLOWED", "A campaign cannot go from " + STAGES[from] + " to " + STAGES[to] + ".", null);
    }
    campaign.setStageSelect(to);
    return Beans.get(CampaignRepository.class).save(campaign);
  }

  private static void apply(Campaign c, Fields f, boolean clearType, boolean clearStart, boolean clearEnd, boolean clearSummary) {
    if (f.name() != null) c.setName(f.name());
    if (f.type() != null) c.setCampaignType(f.type()); else if (clearType) c.setCampaignType(null);
    if (f.start() != null) c.setEventStartDateT(f.start()); else if (clearStart) c.setEventStartDateT(null);
    if (f.end() != null) c.setEventEndDateT(f.end()); else if (clearEnd) c.setEventEndDateT(null);
    if (f.owner() != null) c.setEventUser(f.owner());
    if (f.summary() != null) c.setDescription(f.summary()); else if (clearSummary) c.setDescription(null);
  }
}
