package com.ioeti.commercial.service;

import com.axelor.apps.base.db.Currency;
import com.axelor.apps.base.db.Product;
import com.axelor.apps.base.db.ProductCategory;
import com.axelor.apps.base.db.Unit;
import com.axelor.apps.base.db.repo.ProductRepository;
import com.axelor.inject.Beans;
import com.google.inject.persist.Transactional;
import java.math.BigDecimal;
import java.time.LocalDate;

/**
 * The service catalogue managed from the platform (capability map: service catalogue). Products are the
 * native AOS {@code Product}, saved through the native repository. Only commercial fields are set here:
 * the revenue account and the taxes that make a product invoiceable are the finance team's set-up for
 * each company and are never guessed (no tax rate is invented).
 */
public class CatalogService {

  /** The commercial fields of a service; a null field is left as it is on update. */
  public record ServiceFields(String code, String name, String summary, String type, Unit unit, BigDecimal salePrice,
      Currency currency, ProductCategory category, Boolean onSale, LocalDate startDate, LocalDate endDate) {}

  @Transactional(rollbackOn = {Exception.class})
  public Product create(ServiceFields fields) {
    Product product = new Product();
    product.setProductTypeSelect(ProductRepository.PRODUCT_TYPE_SERVICE);
    product.setSellable(true);
    product.setIsModel(false);
    apply(product, fields, true);
    return Beans.get(ProductRepository.class).save(product);
  }

  @Transactional(rollbackOn = {Exception.class})
  public Product update(Product product, ServiceFields fields, boolean clearSummary, boolean clearUnit, boolean clearCategory,
      boolean clearStart, boolean clearEnd) {
    apply(product, fields, false);
    if (clearSummary) product.setDescription(null);
    if (clearUnit) product.setUnit(null);
    if (clearCategory) product.setProductCategory(null);
    if (clearStart) product.setStartDate(null);
    if (clearEnd) product.setEndDate(null);
    return Beans.get(ProductRepository.class).save(product);
  }

  private static void apply(Product product, ServiceFields f, boolean creating) {
    if (f.code() != null) product.setCode(f.code());
    if (f.name() != null) product.setName(f.name());
    if (f.summary() != null) product.setDescription(f.summary());
    if (f.type() != null) product.setProductTypeSelect(f.type());
    if (f.unit() != null) product.setUnit(f.unit());
    if (f.salePrice() != null) product.setSalePrice(f.salePrice());
    if (f.currency() != null) product.setSaleCurrency(f.currency());
    if (f.category() != null) product.setProductCategory(f.category());
    if (f.onSale() != null) product.setSellable(f.onSale());
    else if (creating) product.setSellable(true);
    if (f.startDate() != null) product.setStartDate(f.startDate());
    if (f.endDate() != null) product.setEndDate(f.endDate());
  }
}
