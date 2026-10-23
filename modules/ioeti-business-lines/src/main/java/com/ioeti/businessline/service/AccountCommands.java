package com.ioeti.businessline.service;

import com.axelor.apps.base.db.Partner;
import com.axelor.apps.base.db.repo.PartnerRepository;
import com.axelor.auth.AuthUtils;
import com.axelor.db.JPA;
import com.axelor.inject.Beans;
import com.axelor.message.db.EmailAddress;
import com.google.inject.persist.Transactional;
import com.ioeti.core.api.ApiException;
import jakarta.persistence.LockModeType;
import java.util.regex.Pattern;

/**
 * Client accounts and their contacts created and changed directly (journeys plan, phase 2): an existing
 * client or a walk-in does not have to pass through a lead first. Accounts are native partners
 * (organisation, prospect) saved through the native repository, which numbers them; contacts are native
 * individual partners linked to their account the way the lead conversion links them.
 */
public class AccountCommands {

  public static final Pattern EMAIL = Pattern.compile("[^@\\s]{1,64}@[^@\\s]{1,190}\\.[A-Za-z]{2,}");
  public static final Pattern PHONE = Pattern.compile("\\+?[0-9\\u0660-\\u0669 ()-]{7,20}");

  public record AccountInput(String name, String website, String phone, String email) {}

  public record ContactInput(String firstName, String name, String phone, String email) {}

  public static String text(String field, String value, int max, boolean required) {
    String text = value == null ? null : value.strip();
    if (text == null || text.isEmpty()) {
      if (required) throw ApiException.invalidField(field, "REQUIRED", "This field is required.");
      return null;
    }
    if (text.length() > max) throw ApiException.invalidField(field, "TOO_LONG", "This field can have at most " + max + " characters.");
    return text;
  }

  public static String email(String value) {
    String email = text("email", value, 255, false);
    if (email != null && !EMAIL.matcher(email).matches()) throw ApiException.invalidField("email", "FORMAT", "Enter a valid e-mail address.");
    return email;
  }

  public static String phone(String value) {
    String phone = text("phone", value, 20, false);
    if (phone != null && !PHONE.matcher(phone).matches()) throw ApiException.invalidField("phone", "FORMAT", "Enter a valid phone number.");
    return phone;
  }

  @Transactional(rollbackOn = {Exception.class})
  public Partner createAccount(AccountInput input) {
    Partner account = new Partner();
    account.setPartnerTypeSelect(PartnerRepository.PARTNER_TYPE_COMPANY);
    account.setIsProspect(true);
    account.setName(input.name());
    account.setWebSite(input.website());
    account.setFixedPhone(input.phone());
    account.setUser(AuthUtils.getUser());
    if (input.email() != null) account.setEmailAddress(address(input.email()));
    return Beans.get(PartnerRepository.class).save(account);
  }

  @Transactional(rollbackOn = {Exception.class})
  public Partner updateAccount(Partner account, AccountInput input, boolean websiteGiven, boolean phoneGiven, boolean emailGiven) {
    if (input.name() != null) account.setName(input.name());
    if (websiteGiven) account.setWebSite(input.website());
    if (phoneGiven) account.setFixedPhone(input.phone());
    if (emailGiven) setEmail(account, input.email());
    return Beans.get(PartnerRepository.class).save(account);
  }

  /** The account's version moves with each new contact, so two people adding contacts never lose one. */
  @Transactional(rollbackOn = {Exception.class})
  public Partner addContact(Partner account, ContactInput input) {
    JPA.em().lock(account, LockModeType.PESSIMISTIC_FORCE_INCREMENT);
    Partner contact = new Partner();
    contact.setPartnerTypeSelect(PartnerRepository.PARTNER_TYPE_INDIVIDUAL);
    contact.setIsContact(true);
    contact.setFirstName(input.firstName());
    contact.setName(input.name());
    contact.setMobilePhone(input.phone());
    contact.setMainPartner(account);
    contact.setUser(AuthUtils.getUser());
    if (input.email() != null) contact.setEmailAddress(address(input.email()));
    Partner saved = Beans.get(PartnerRepository.class).save(contact);
    account.addContactPartnerSetItem(saved);
    return saved;
  }

  private static void setEmail(Partner partner, String email) {
    if (email == null) {
      partner.setEmailAddress(null);
    } else if (partner.getEmailAddress() == null) {
      partner.setEmailAddress(address(email));
    } else {
      partner.getEmailAddress().setAddress(email);
    }
  }

  private static EmailAddress address(String email) {
    EmailAddress address = new EmailAddress();
    address.setAddress(email);
    return JPA.save(address);
  }
}
