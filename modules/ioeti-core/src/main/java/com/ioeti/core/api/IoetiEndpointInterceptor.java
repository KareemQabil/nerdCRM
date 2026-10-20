package com.ioeti.core.api;

import org.aopalliance.intercept.MethodInterceptor;
import org.aopalliance.intercept.MethodInvocation;

/** Converts anything an {@link IoetiEndpoint} method throws into the IOETI error contract. */
public class IoetiEndpointInterceptor implements MethodInterceptor {

  @Override
  public Object invoke(MethodInvocation invocation) {
    try {
      return invocation.proceed();
    } catch (Throwable error) {
      return ApiErrors.from(error);
    }
  }
}
