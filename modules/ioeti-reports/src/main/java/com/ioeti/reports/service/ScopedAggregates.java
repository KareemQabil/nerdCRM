package com.ioeti.reports.service;

import com.axelor.db.JPA;
import com.axelor.db.JpaSecurity;
import com.axelor.db.Model;
import com.axelor.inject.Beans;
import com.axelor.rpc.filter.Filter;
import jakarta.persistence.Query;
import java.util.ArrayList;
import java.util.List;

/**
 * Aggregate queries that stay inside the caller's read permissions.
 *
 * <p>The native security filter for the entity (a JPQL condition on {@code self}) is added to the
 * WHERE clause of every query, so counts and sums only ever cover records the caller could list.
 * When the caller has no read right on the entity at all, {@link #permitted} is false and the report
 * leaves the area out.
 */
public final class ScopedAggregates {

  private ScopedAggregates() {}

  public static boolean permitted(Class<? extends Model> type) {
    return Beans.get(JpaSecurity.class).isPermitted(JpaSecurity.CAN_READ, type);
  }

  /**
   * Runs {@code SELECT <select> FROM <Entity> self <joins> WHERE <security> AND <condition>
   * [GROUP BY <groupBy>]}. Positional parameters in {@code condition} are written as {@code ?}.
   */
  public static List<Object[]> rows(Class<? extends Model> type, String select, String joins, String condition, List<Object> params,
      String groupBy) {
    Filter security = Beans.get(JpaSecurity.class).getFilter(JpaSecurity.CAN_READ, type);
    List<String> where = new ArrayList<>(List.of("(self.archived IS NULL OR self.archived = false)"));
    List<Object> values = new ArrayList<>();
    if (security != null) {
      where.add("(" + security.toString() + ")");
      values.addAll(security.getParams());
    }
    if (condition != null && !condition.isBlank()) {
      where.add("(" + condition + ")");
      values.addAll(params);
    }
    String jpql = numbered("SELECT " + select + " FROM " + type.getSimpleName() + " self " + (joins == null ? "" : joins + " ")
        + "WHERE " + String.join(" AND ", where) + (groupBy == null ? "" : " GROUP BY " + groupBy));
    Query query = JPA.em().createQuery(jpql);
    for (int i = 0; i < values.size(); i++) query.setParameter(i + 1, values.get(i));
    List<Object[]> out = new ArrayList<>();
    for (Object row : query.getResultList()) out.add(row instanceof Object[] array ? array : new Object[] {row});
    return out;
  }

  public static long count(Class<? extends Model> type, String condition, List<Object> params) {
    List<Object[]> rows = rows(type, "count(self)", null, condition, params, null);
    return rows.isEmpty() || rows.get(0)[0] == null ? 0 : ((Number) rows.get(0)[0]).longValue();
  }

  /** Numbers the plain {@code ?} placeholders ({@code ?1}, {@code ?2}, …), as the native Filter does. */
  static String numbered(String jpql) {
    StringBuilder sb = new StringBuilder(jpql);
    int n = 0;
    for (int i = sb.indexOf("?"); i > -1; i = sb.indexOf("?", i + 1)) {
      if (i + 1 < sb.length() && Character.isDigit(sb.charAt(i + 1))) continue;
      sb.replace(i, i + 1, "?" + (++n));
    }
    return sb.toString();
  }
}
