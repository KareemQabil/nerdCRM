package com.ioeti.core.security;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import jakarta.websocket.CloseReason;
import jakarta.websocket.Session;
import java.lang.reflect.AccessibleObject;
import java.lang.reflect.Method;
import java.lang.reflect.Proxy;
import java.util.ArrayList;
import java.util.Date;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.aopalliance.intercept.MethodInvocation;
import org.apache.shiro.session.ExpiredSessionException;
import org.apache.shiro.session.StoppedSessionException;
import org.apache.shiro.subject.Subject;
import org.junit.jupiter.api.Test;

class WebSocketSessionGuardTest {

  /** A WebSocket session whose captured subject has the given Shiro session (or none). */
  private static Session socket(Object shiroSession, boolean withSubject, List<CloseReason> closed) {
    Map<String, Object> props = new HashMap<>();
    if (withSubject) {
      Subject subject = (Subject) Proxy.newProxyInstance(Subject.class.getClassLoader(),
          new Class<?>[] {Subject.class}, (p, m, a) -> m.getName().equals("getSession") ? shiroSession : null);
      props.put(Subject.class.getName(), subject);
    }
    return (Session) Proxy.newProxyInstance(Session.class.getClassLoader(), new Class<?>[] {Session.class},
        (p, m, a) -> {
          if (m.getName().equals("getUserProperties")) return props;
          if (m.getName().equals("getId")) return "ws-1";
          if (m.getName().equals("close") && a != null) closed.add((CloseReason) a[0]);
          return null;
        });
  }

  private static org.apache.shiro.session.Session shiroSession(RuntimeException failure) {
    return (org.apache.shiro.session.Session) Proxy.newProxyInstance(
        org.apache.shiro.session.Session.class.getClassLoader(),
        new Class<?>[] {org.apache.shiro.session.Session.class}, (p, m, a) -> {
          if (failure != null) throw failure;
          return m.getName().equals("getLastAccessTime") ? new Date() : null;
        });
  }

  @Test
  void liveOnlyWithAValidServerSideSession() {
    List<CloseReason> closed = new ArrayList<>();
    assertTrue(WebSocketSessionGuard.isLive(socket(shiroSession(null), true, closed)));
    assertFalse(WebSocketSessionGuard.isLive(socket(null, true, closed)), "no session");
    assertFalse(WebSocketSessionGuard.isLive(socket(null, false, closed)), "no captured subject");
    assertFalse(WebSocketSessionGuard.isLive(socket(shiroSession(new StoppedSessionException("logout")), true, closed)));
    assertFalse(WebSocketSessionGuard.isLive(socket(shiroSession(new ExpiredSessionException("expired")), true, closed)));
  }

  @Test
  void endedSessionClosesTheSocketWithoutHandlingTheMessage() throws Throwable {
    List<CloseReason> closed = new ArrayList<>();
    Session ended = socket(shiroSession(new StoppedSessionException("logout")), true, closed);
    boolean[] proceeded = {false};
    Object result = new WebSocketSessionGuard().invoke(invocation(new Object[] {ended, "message"}, proceeded));
    assertNull(result);
    assertFalse(proceeded[0]);
    assertEquals(1, closed.size());
    assertEquals(CloseReason.CloseCodes.VIOLATED_POLICY, closed.get(0).getCloseCode());

    Session live = socket(shiroSession(null), true, closed);
    new WebSocketSessionGuard().invoke(invocation(new Object[] {live, "message"}, proceeded));
    assertTrue(proceeded[0]);
    assertEquals(1, closed.size());
  }

  private static MethodInvocation invocation(Object[] args, boolean[] proceeded) {
    return new MethodInvocation() {
      public Method getMethod() { return null; }
      public Object[] getArguments() { return args; }
      public Object proceed() { proceeded[0] = true; return "handled"; }
      public Object getThis() { return null; }
      public AccessibleObject getStaticPart() { return null; }
    };
  }
}
