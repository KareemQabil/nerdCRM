package com.ioeti.core.security;

import jakarta.websocket.CloseReason;
import jakarta.websocket.Session;
import java.io.IOException;
import java.util.Arrays;
import org.aopalliance.intercept.MethodInterceptor;
import org.aopalliance.intercept.MethodInvocation;
import org.apache.shiro.session.InvalidSessionException;
import org.apache.shiro.subject.Subject;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Closes an open WebSocket when its HTTP session has ended (SEC-001 residual, issue #10).
 *
 * <p>AOP 8.2.5 captures the HTTP session's Shiro {@link Subject} at the WebSocket handshake
 * ({@code WebSocketConfigurator.modifyHandshake}). It then checks {@code subject.isAuthenticated()}
 * for every message ({@code WebSocketSecurityInterceptor}). That flag belongs to the captured subject,
 * so a logout through another request does not change it: an already-open socket kept answering with
 * the user's data after logout (seen live in {@code scripts/websocket_identity_probe.py}).
 *
 * <p>This interceptor runs before each {@code @OnMessage} handler. It reads the server-side Shiro
 * session behind the captured subject: {@code getLastAccessTime()} validates the session without
 * extending it. If the session is stopped (logout) or expired, the socket is closed with
 * {@code VIOLATED_POLICY} and the message is not handled. No upstream file is modified.
 */
public class WebSocketSessionGuard implements MethodInterceptor {

  private static final Logger LOG = LoggerFactory.getLogger(WebSocketSessionGuard.class);
  private static final String SUBJECT_KEY = Subject.class.getName();

  @Override
  public Object invoke(MethodInvocation invocation) throws Throwable {
    Session socket = Arrays.stream(invocation.getArguments())
        .filter(Session.class::isInstance).map(Session.class::cast).findFirst().orElse(null);
    if (socket == null || isLive(socket)) {
      return invocation.proceed();
    }
    LOG.info("Closing WebSocket {}: its HTTP session has ended", socket.getId());
    try {
      socket.close(new CloseReason(CloseReason.CloseCodes.VIOLATED_POLICY, "Session ended"));
    } catch (IOException e) {
      // the client is already gone
    }
    return null;
  }

  /** True when the socket's captured subject still has a valid server-side session. */
  static boolean isLive(Session socket) {
    Object subject = socket.getUserProperties().get(SUBJECT_KEY);
    if (!(subject instanceof Subject captured)) {
      return false;
    }
    try {
      org.apache.shiro.session.Session session = captured.getSession(false);
      if (session == null) {
        return false;
      }
      session.getLastAccessTime(); // validates against the session manager; throws when ended
      return true;
    } catch (InvalidSessionException e) {
      return false;
    }
  }
}
