package com.ioeti.core.api;

import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * Marks an IOETI JAX-RS method whose failures must follow the {@link ApiErrors} contract. Use it
 * instead of the AOS {@code @HttpExceptionHandler}, which turns every client error other than
 * 400/403/404 into 409 and returns internal exception messages on 500.
 */
@Retention(RetentionPolicy.RUNTIME)
@Target({ElementType.METHOD, ElementType.TYPE})
public @interface IoetiEndpoint {}
