package com.ioeti.admin.rest;

import com.axelor.auth.AuthUtils;
import com.axelor.auth.MFAService;
import com.axelor.auth.db.MFA;
import com.axelor.auth.db.MFAMethod;
import com.axelor.auth.db.User;
import com.axelor.inject.Beans;
import com.axelor.utils.api.ResponseConstructor;
import com.ioeti.admin.service.AdminService;
import com.ioeti.core.api.ApiException;
import com.ioeti.core.api.IoetiEndpoint;
import io.swagger.v3.oas.annotations.Operation;
import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import java.util.Base64;
import java.util.List;

/**
 * D-07 (signed 2026-10-25): multi-factor sign-in is <b>optional</b>; each person may turn it on for themselves.
 *
 * <p>This is the native Axelor MFA (TOTP authenticator apps, recovery codes; the sign-in callback asks for the code). The
 * platform adds a self-service API for the custom screens and an administrator reset for a lost device. E-mail codes are not
 * offered: sending e-mail from the platform is a D-10 channel.
 *
 * <ul>
 *   <li>Turning it on: start (a secret and its QR code), then confirm with a code from the app; only then is MFA enabled and
 *       recovery codes are shown, once.
 *   <li>Turning it off, or new recovery codes: a current code (from the app, or a recovery code) is required.
 *   <li>An administrator may reset a person's MFA (lost phone) through {@code POST /ws/ioeti/admin/users/{id}/mfa/reset}; it is
 *       audited and the person signs in with their password and may turn MFA on again.
 * </ul>
 */
@Path("/ioeti")
@Produces(MediaType.APPLICATION_JSON)
public class MfaRestController {

  static final String RECOVERY = "RECOVERY";

  @GET
  @Path("/me/mfa")
  @Operation(summary = "Whether multi-factor sign-in is on for the signed-in person", tags = {"IOETI security"})
  @IoetiEndpoint
  public Response status() {
    return ResponseConstructor.build(Response.Status.OK, "MFA", view(me()));
  }

  @POST
  @Path("/me/mfa/start")
  @Operation(summary = "Start setting up an authenticator app: a new secret and its QR code (not yet enabled)", tags = {"IOETI security"})
  @IoetiEndpoint
  public Response start() {
    User me = me();
    MFAService service = Beans.get(MFAService.class);
    MFA mfa = service.getRelatedMfa(me, true);
    if (Boolean.TRUE.equals(mfa.getEnabled())) throw new ApiException(422, "MFA_ALREADY_ON", "Multi-factor sign-in is already on.", null);
    byte[] png = service.configureTOTP(mfa);
    MFA saved = service.getRelatedMfa(me, false);
    return ResponseConstructor.build(Response.Status.OK, "MFA set-up", new MfaSetup(saved.getTotpSecret(),
        "data:image/png;base64," + Base64.getEncoder().encodeToString(png)));
  }

  @POST
  @Path("/me/mfa/confirm")
  @Consumes(MediaType.APPLICATION_JSON)
  @Operation(summary = "Confirm the authenticator with a code: MFA is turned on and recovery codes are returned once", tags = {"IOETI security"})
  @IoetiEndpoint
  public Response confirm(MfaCode command) {
    User me = me();
    MFAService service = Beans.get(MFAService.class);
    MFA mfa = service.getRelatedMfa(me, false);
    if (mfa == null || mfa.getTotpSecret() == null) throw new ApiException(422, "MFA_NOT_STARTED", "Start the set-up first.", null);
    if (Boolean.TRUE.equals(mfa.getEnabled())) throw new ApiException(422, "MFA_ALREADY_ON", "Multi-factor sign-in is already on.", null);
    String code = code(command);
    try {
      service.validateMethod(mfa, code, MFAMethod.TOTP);
    } catch (RuntimeException e) {
      throw ApiException.invalidField("code", "INVALID", "The code does not match. Use the current code from the app.");
    }
    MFA current = service.getRelatedMfa(me, false);
    if (!Boolean.TRUE.equals(current.getIsTotpValidated())) {
      throw ApiException.invalidField("code", "INVALID", "The code does not match. Use the current code from the app.");
    }
    service.setDefaultMethod(current, MFAMethod.TOTP);
    service.enableMFA(service.getRelatedMfa(me, false));
    List<String> codes = service.generateRecoveryCodes(service.getRelatedMfa(me, false));
    audit("MFA_ENABLED", me, List.of("method=TOTP"));
    return ResponseConstructor.build(Response.Status.OK, "MFA on", new MfaEnabled(view(me), codes));
  }

  @POST
  @Path("/me/mfa/disable")
  @Consumes(MediaType.APPLICATION_JSON)
  @Operation(summary = "Turn multi-factor sign-in off with a current code (app or recovery)", tags = {"IOETI security"})
  @IoetiEndpoint
  public Response disable(MfaCode command) {
    User me = me();
    MFA mfa = enabled(me);
    verify(me, command);
    MFAService service = Beans.get(MFAService.class);
    service.disableMFA(mfa);
    audit("MFA_DISABLED", me, List.of("by=self"));
    return ResponseConstructor.build(Response.Status.OK, "MFA off", view(me));
  }

  @POST
  @Path("/me/mfa/recovery-codes")
  @Consumes(MediaType.APPLICATION_JSON)
  @Operation(summary = "New recovery codes (the old ones stop working), with a current code", tags = {"IOETI security"})
  @IoetiEndpoint
  public Response recoveryCodes(MfaCode command) {
    User me = me();
    MFA mfa = enabled(me);
    verify(me, command);
    List<String> codes = Beans.get(MFAService.class).generateRecoveryCodes(mfa);
    audit("MFA_RECOVERY_CODES", me, List.of("regenerated"));
    return ResponseConstructor.build(Response.Status.OK, "Recovery codes", new MfaEnabled(view(me), codes));
  }

  // --- helpers -----------------------------------------------------------------------------------------------

  static User me() {
    User me = AuthUtils.getUser();
    if (me == null) throw new ApiException(401, "UNAUTHENTICATED", "Sign in first.", null);
    return me;
  }

  static String code(MfaCode command) {
    String code = command == null || command.code() == null ? "" : command.code().strip();
    if (code.isEmpty()) throw ApiException.invalidField("code", "REQUIRED", "Enter the code.");
    if (code.length() > 40) throw ApiException.invalidField("code", "TOO_LONG", "This is not a code.");
    return code;
  }

  static MFA enabled(User user) {
    MFA mfa = Beans.get(MFAService.class).getRelatedMfa(user, false);
    if (mfa == null || !Boolean.TRUE.equals(mfa.getEnabled())) throw new ApiException(422, "MFA_NOT_ON", "Multi-factor sign-in is not on.", null);
    return mfa;
  }

  /** A code from the app, or a recovery code (which is then used up, natively). */
  static void verify(User user, MfaCode command) {
    String code = code(command);
    String method = command.recovery() ? RECOVERY : MFAMethod.TOTP.name();
    if (!Beans.get(MFAService.class).verifyCode(user, code, method)) {
      throw ApiException.invalidField("code", "INVALID", "The code does not match.");
    }
  }

  /** Resets a person's MFA (lost device); called by the administrators' API, which checks the caller. */
  static MfaView reset(User user) {
    MFAService service = Beans.get(MFAService.class);
    MFA mfa = service.getRelatedMfa(user, false);
    if (mfa == null || !Boolean.TRUE.equals(mfa.getEnabled())) throw new ApiException(422, "MFA_NOT_ON", "Multi-factor sign-in is not on for this person.", null);
    service.disableMFA(mfa);
    audit("MFA_RESET", user, List.of("by=administrator"));
    return view(user);
  }

  /**
   * Reading never creates: the native {@code getRelatedMfa(user)} creates an empty MFA row when there is none, which would
   * write on every visit to Settings and keep the person from being deleted. Only {@link #start()} creates one.
   */
  static MfaView view(User user) {
    MFA mfa = Beans.get(MFAService.class).getRelatedMfa(user, false);
    boolean on = mfa != null && Boolean.TRUE.equals(mfa.getEnabled());
    return new MfaView(on, on ? "TOTP" : null);
  }

  static void audit(String action, User subject, List<String> changes) {
    Beans.get(AdminService.class).auditChange(action, "USER", subject.getId(), subject.getCode(), changes);
  }

  public record MfaCode(String code, boolean recovery) {}

  public record MfaView(boolean enabled, String method) {}

  public record MfaSetup(String secret, String qrCode) {}

  public record MfaEnabled(MfaView status, List<String> recoveryCodes) {}
}
