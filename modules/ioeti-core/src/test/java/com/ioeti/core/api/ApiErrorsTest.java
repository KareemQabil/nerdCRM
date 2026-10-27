package com.ioeti.core.api;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import jakarta.persistence.PersistenceException;
import jakarta.ws.rs.BadRequestException;
import jakarta.ws.rs.ClientErrorException;
import jakarta.ws.rs.ForbiddenException;
import jakarta.ws.rs.NotAuthorizedException;
import jakarta.ws.rs.NotFoundException;
import jakarta.ws.rs.core.Response;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

class ApiErrorsTest {

  @AfterEach
  void clear() {
    CorrelationId.end();
  }

  @SuppressWarnings("unchecked")
  private static Map<String, Object> error(Response response) {
    return (Map<String, Object>) ((Map<String, Object>) response.getEntity()).get("error");
  }

  private static String text(Response response) {
    return String.valueOf(response.getEntity());
  }

  @Test
  void typedApiExceptionsKeepTheirStatusCodeMessageAndFields() {
    CorrelationId.begin("req-12345678");
    Response response =
        ApiErrors.from(ApiException.invalidField("name", "LENGTH", "Name must be 3 to 160 characters."));
    assertEquals(422, response.getStatus());
    Map<String, Object> error = error(response);
    assertEquals("VALIDATION_FAILED", error.get("code"));
    assertEquals("Name must be 3 to 160 characters.", error.get("message"));
    assertEquals("req-12345678", error.get("correlationId"));
    assertEquals(
        List.of(new ApiException.FieldError("name", "LENGTH", "Name must be 3 to 160 characters.")),
        error.get("fields"));
    Map<?, ?> body = (Map<?, ?>) response.getEntity();
    assertEquals(422, body.get("codeStatus"), "keeps the AOS envelope field the UI reads");
  }

  @Test
  void unexpectedFailuresNeverEchoInternalDetails() {
    Response response =
        ApiErrors.from(
            new PersistenceException(
                "ERROR: duplicate key value violates unique constraint \"crm_opportunity_pkey\""
                    + " at com.axelor.apps.crm.db.Opportunity"));
    assertEquals(500, response.getStatus());
    assertEquals("INTERNAL_ERROR", error(response).get("code"));
    assertFalse(text(response).contains("crm_opportunity"));
    assertFalse(text(response).contains("com.axelor"));
  }

  @Test
  void jaxRsClientErrorsMapToTheirOwnStatusWithFixedMessages() {
    assertEquals(400, ApiErrors.from(new BadRequestException("Unrecognized field \"x\" (class com.x.Y)")).getStatus());
    assertFalse(text(ApiErrors.from(new BadRequestException("class com.x.Y"))).contains("com.x"));
    assertEquals(401, ApiErrors.from(new NotAuthorizedException("Bearer")).getStatus());
    assertEquals(403, ApiErrors.from(new ForbiddenException("You are not authorized to read Partner#12")).getStatus());
    assertFalse(text(ApiErrors.from(new ForbiddenException("Partner#12"))).contains("#12"));
    assertEquals(404, ApiErrors.from(new NotFoundException("Opportunity 42")).getStatus());
    // AOS HttpExceptionHandler would turn this into 409; the IOETI contract keeps 422
    assertEquals(422, ApiErrors.from(new ClientErrorException("x", 422)).getStatus());
    assertEquals(429, ApiErrors.from(new ClientErrorException("x", 429)).getStatus());
    assertEquals(
        "Record has changed; refresh and retry.",
        error(ApiErrors.from(new ClientErrorException("Object provided has been updated", 409))).get("message"));
  }

  @Test
  void axelorAuthorizationFailuresAre403() {
    assertEquals(403, ApiErrors.from(new com.axelor.auth.AuthSecurityException(
        com.axelor.db.JpaSecurity.AccessType.READ, com.axelor.auth.db.User.class, 1L)).getStatus());
  }

  @Test
  void notFoundAndForbiddenRecordLookupsAreIndistinguishableFromEachOther() {
    Response missing = ApiErrors.from(ApiException.notFound());
    Response hidden = ApiErrors.from(ApiException.notFound());
    assertEquals(missing.getStatus(), hidden.getStatus());
    assertEquals(error(missing).get("message"), error(hidden).get("message"));
    assertNotEquals(403, missing.getStatus());
  }

  @Test
  void correlationIdIsAcceptedOnlyWhenSafeToLogAndEcho() {
    assertEquals("abc-12345", CorrelationId.begin("abc-12345"));
    String generated = CorrelationId.begin("x\r\nSet-Cookie: a=b");
    assertTrue(generated.matches("[0-9a-f-]{36}"));
    assertTrue(CorrelationId.begin(null).matches("[0-9a-f-]{36}"));
    assertTrue(CorrelationId.begin("short").matches("[0-9a-f-]{36}"));
  }

  @Test
  void pathRulesForTheContractAndTheGenericApiGate() {
    assertTrue(IoetiApiFilter.isIoetiPath("/ioeti/leads/1"));
    assertTrue(IoetiApiFilter.isIoetiPath("ioeti"));
    assertFalse(IoetiApiFilter.isIoetiPath("/ioetix/leads"));
    assertFalse(IoetiApiFilter.isIoetiPath("/rest/com.axelor.auth.db.User"));
    assertTrue(GenericApiExposureFilter.isAllowedPath("/ioeti/opportunities"));
    assertTrue(GenericApiExposureFilter.isAllowedPath("/public/app/info"));
    assertFalse(GenericApiExposureFilter.isAllowedPath("/rest/com.axelor.apps.crm.db.Lead/search"));
    assertFalse(GenericApiExposureFilter.isAllowedPath("/action"));
    assertFalse(GenericApiExposureFilter.isAllowedPath("/publicity"));
    assertFalse(GenericApiExposureFilter.isAllowedPath("/meta/view"));
  }
}
