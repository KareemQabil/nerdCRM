package com.ioeti.recruitment.rest;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.ioeti.core.api.ApiException;
import com.ioeti.recruitment.db.repo.CandidateApplicationRepository;
import com.ioeti.recruitment.service.RecruitmentService;
import org.junit.jupiter.api.Test;

class RecruitmentRulesTest {

  @Test
  void manualStageMovesOnlyGoForwardOneStep() {
    assertTrue(RecruitmentService.canMove(CandidateApplicationRepository.STAGE_SOURCED, CandidateApplicationRepository.STAGE_SCREENED));
    assertTrue(RecruitmentService.canMove(CandidateApplicationRepository.STAGE_SCREENED, CandidateApplicationRepository.STAGE_SHORTLISTED));
    // submission, offer and placement have their own commands with their own checks
    assertFalse(RecruitmentService.canMove(CandidateApplicationRepository.STAGE_SHORTLISTED, CandidateApplicationRepository.STAGE_SUBMITTED));
    assertFalse(RecruitmentService.canMove(CandidateApplicationRepository.STAGE_SOURCED, CandidateApplicationRepository.STAGE_INTERVIEWING));
    assertFalse(RecruitmentService.canMove(CandidateApplicationRepository.STAGE_PLACED, CandidateApplicationRepository.STAGE_SCREENED));
  }

  @Test
  void placedRejectedAndWithdrawnAreFinal() {
    assertTrue(RecruitmentService.isClosed(CandidateApplicationRepository.STAGE_PLACED));
    assertTrue(RecruitmentService.isClosed(CandidateApplicationRepository.STAGE_REJECTED));
    assertTrue(RecruitmentService.isClosed(CandidateApplicationRepository.STAGE_WITHDRAWN));
    assertFalse(RecruitmentService.isClosed(CandidateApplicationRepository.STAGE_OFFERED));
  }

  @Test
  void contactFormatsAndDatesAreFieldErrors() {
    assertTrue(RecruitmentRestController.EMAIL.matcher("a.b@example.com").matches());
    assertFalse(RecruitmentRestController.EMAIL.matcher("not-an-email").matches());
    assertTrue(RecruitmentRestController.PHONE.matcher("+20 100 555 0101").matches());
    assertFalse(RecruitmentRestController.PHONE.matcher("12ab").matches());
    assertEquals("offerDate", assertThrows(ApiException.class,
        () -> RecruitmentRestController.requiredDate("offerDate", "05/11/2026")).fieldErrors().get(0).field());
    assertNull(RecruitmentRestController.checkedText("location", " ", 255, false));
  }

  @Test
  void stableApiNames() {
    assertEquals("SHORTLISTED", RecruitmentRestController.name(3, RecruitmentRestController.STAGES));
    assertEquals("WITHDRAWN", RecruitmentRestController.name(9, RecruitmentRestController.STAGES));
    assertNull(RecruitmentRestController.name(10, RecruitmentRestController.STAGES));
  }
}
