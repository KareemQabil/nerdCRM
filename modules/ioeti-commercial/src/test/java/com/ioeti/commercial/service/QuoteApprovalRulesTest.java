package com.ioeti.commercial.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.axelor.apps.sale.db.SaleOrder;
import com.axelor.apps.sale.db.SaleOrderLine;
import com.axelor.apps.sale.db.repo.SaleOrderLineRepository;
import com.axelor.auth.db.Group;
import com.axelor.auth.db.Role;
import com.axelor.auth.db.User;
import java.math.BigDecimal;
import java.util.List;
import java.util.Set;
import org.junit.jupiter.api.Test;

/** D-11: how a quotation's discount is measured and who holds an approver's role. */
class QuoteApprovalRulesTest {

  /** A line with a native discount: type 0 none, 1 percent, 2 fixed amount off the unit price. */
  private static SaleOrderLine line(int type, String qty, String price, int discountType, String discount) {
    SaleOrderLine line = new SaleOrderLine();
    line.setTypeSelect(type);
    line.setQty(new BigDecimal(qty));
    line.setPrice(new BigDecimal(price));
    line.setDiscountTypeSelect(discountType);
    line.setDiscountAmount(new BigDecimal(discount));
    return line;
  }

  private static SaleOrder quote(SaleOrderLine... lines) {
    SaleOrder quote = new SaleOrder();
    quote.setSaleOrderLineList(List.of(lines));
    return quote;
  }

  @Test
  void discountIsWeightedByQuantityAndPriceOverNormalLinesOnly() {
    int normal = SaleOrderLineRepository.TYPE_NORMAL;
    // 2 × 1500 at 10% off and 1 × 1000 with 100 off: 1 − (2700 + 900) / 4000 = 10%
    assertEquals(new BigDecimal("10.00"), QuoteApprovalService.discountPercent(quote(
        line(normal, "2", "1500", 1, "10"), line(normal, "1", "1000", 2, "100"))));
    // a title line does not count; a line not computed yet (no discounted price stored) is not a 100% discount
    SaleOrderLine uncomputed = line(normal, "1", "1000", 0, "0");
    assertEquals(0, uncomputed.getPriceDiscounted().signum()); // the generated getter reads 0 until AOS computes the line
    assertEquals(new BigDecimal("0.00"), QuoteApprovalService.discountPercent(quote(
        uncomputed, line(SaleOrderLineRepository.TYPE_TITLE, "1", "500", 1, "100"))));
    assertEquals(BigDecimal.ZERO, QuoteApprovalService.discountPercent(quote()));
    // a fixed amount above the price is a full discount, never below zero
    assertEquals(new BigDecimal("100.00"), QuoteApprovalService.discountPercent(quote(line(normal, "1", "1000", 2, "1500"))));
  }

  @Test
  void approverCodesMapToAxelorRoles() {
    assertEquals("ioeti-sales-manager", QuoteApprovalService.roleOf("SALES_MANAGER"));
    assertEquals("ioeti-gm", QuoteApprovalService.roleOf("GM"));
  }

  @Test
  void aRoleCountsDirectlyOrThroughTheGroupAndNoneIsNobodysRole() {
    User direct = new User();
    direct.setRoles(Set.of(new Role("ioeti-sales-manager")));
    User viaGroup = new User();
    Group group = new Group();
    group.setRoles(Set.of(new Role("ioeti-gm")));
    viaGroup.setGroup(group);
    assertTrue(QuoteApprovalService.holds(direct, "SALES_MANAGER"));
    assertFalse(QuoteApprovalService.holds(direct, "GM"));
    assertTrue(QuoteApprovalService.holds(viaGroup, "GM"));
    assertFalse(QuoteApprovalService.holds(viaGroup, "SALES_MANAGER"));
    assertFalse(QuoteApprovalService.holds(direct, "NONE"));
    assertFalse(QuoteApprovalService.holds(null, "GM"));
  }
}
