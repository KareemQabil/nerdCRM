package com.ioeti.core.api;

import com.axelor.db.JPA;
import com.axelor.db.JpaSecurity;
import com.axelor.db.Model;
import com.axelor.inject.Beans;

/**
 * Record lookups for IOETI endpoints without an existence oracle (SEC-002).
 *
 * <ul>
 *   <li>No permission on the model at all: 403. This says nothing about any record.
 *   <li>Record missing, or present but outside the caller's read scope: the same 404.
 *   <li>Readable but not writable: 403. The caller can already see that the record exists.
 * </ul>
 */
public final class RecordAccess {

  private RecordAccess() {}

  public static <T extends Model> T readable(Class<T> type, Long id) {
    JpaSecurity security = Beans.get(JpaSecurity.class);
    if (!security.isPermitted(JpaSecurity.CAN_READ, type)) {
      throw ApiException.forbidden();
    }
    if (id == null || id <= 0) {
      throw ApiException.notFound();
    }
    T record = JPA.find(type, id);
    if (record == null || !security.isPermitted(JpaSecurity.CAN_READ, type, id)) {
      throw ApiException.notFound();
    }
    return record;
  }

  public static <T extends Model> T writable(Class<T> type, Long id) {
    T record = readable(type, id);
    if (!Beans.get(JpaSecurity.class).isPermitted(JpaSecurity.CAN_WRITE, type, id)) {
      throw ApiException.forbidden();
    }
    return record;
  }
}
