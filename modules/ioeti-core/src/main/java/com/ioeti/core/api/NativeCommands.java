package com.ioeti.core.api;

import com.axelor.apps.base.AxelorException;
import com.axelor.apps.base.db.repo.TraceBackRepository;
import com.ioeti.core.web.OptimisticLockConflicts;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Runs native AOS writes for IOETI endpoints and maps their failures to the IOETI contract.
 *
 * <ul>
 *   <li>A concurrent write: 409 (through {@link OptimisticLockConflicts}).
 *   <li>A native business rule (an {@code AxelorException} anywhere in the cause chain): 422. AOS
 *       reports some of them through CDI observers ({@code ObserverBaseException}) and some through
 *       repository saves ({@code PersistenceException}). Configuration errors answer
 *       {@code SETUP_REQUIRED}, the others the command's own code. The native message is logged with
 *       the correlation id, with restricted personal data masked (G-007), and never sent.
 *   <li>Anything else propagates (500 with a correlation id, from the IOETI error contract).
 * </ul>
 */
public final class NativeCommands {

  private static final Logger LOG = LoggerFactory.getLogger(NativeCommands.class);

  @FunctionalInterface
  public interface NativeCommand {
    void run() throws AxelorException;
  }

  private NativeCommands() {}

  public static void run(NativeCommand command, String rejectedCode, String rejectedMessage) {
    OptimisticLockConflicts.translate(() -> {
      try {
        command.run();
      } catch (AxelorException e) {
        throw rejected(e, rejectedCode, rejectedMessage);
      } catch (ApiException e) {
        throw e;
      } catch (RuntimeException e) {
        AxelorException cause = axelorCause(e);
        if (cause == null) throw e;
        throw rejected(cause, rejectedCode, rejectedMessage);
      }
    });
  }

  public static ApiException rejected(AxelorException e, String code, String message) {
    LOG.warn("Command refused by AOS [correlationId={}, category={}]: {}",
        CorrelationId.current(), e.getCategory(), PiiMasker.mask(e.getMessage()));
    if (e.getCategory() == TraceBackRepository.CATEGORY_CONFIGURATION_ERROR) {
      return new ApiException(
          422, "SETUP_REQUIRED", "Setup for this company or product is incomplete.", null);
    }
    return new ApiException(422, code, message, null);
  }

  public static AxelorException axelorCause(Throwable error) {
    for (Throwable t = error; t != null; t = t.getCause() == t ? null : t.getCause()) {
      if (t instanceof AxelorException found) return found;
    }
    return null;
  }
}
