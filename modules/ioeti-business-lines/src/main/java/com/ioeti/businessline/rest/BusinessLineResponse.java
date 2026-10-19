package com.ioeti.businessline.rest;

import com.axelor.team.db.Team;
import com.ioeti.businessline.db.BusinessLine;

/** Stable API contract for a business line (decoupled from the JPA entity). */
public record BusinessLineResponse(
    Long id,
    String code,
    String nameEn,
    String nameAr,
    Integer status,
    Integer sequence,
    String responsibleTeam) {

  public static BusinessLineResponse of(BusinessLine line) {
    Team team = line.getResponsibleTeam();
    return new BusinessLineResponse(
        line.getId(),
        line.getCode(),
        line.getNameEn(),
        line.getNameAr(),
        line.getStatusSelect(),
        line.getSequence(),
        team == null ? null : team.getName());
  }
}
