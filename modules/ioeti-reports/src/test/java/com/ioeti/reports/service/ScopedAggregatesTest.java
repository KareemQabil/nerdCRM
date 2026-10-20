package com.ioeti.reports.service;

import static org.junit.jupiter.api.Assertions.assertEquals;

import org.junit.jupiter.api.Test;

class ScopedAggregatesTest {

  @Test
  void placeholdersAreNumberedInOrder() {
    assertEquals("SELECT x FROM A self WHERE (self.user = ?1) AND (self.createdOn >= ?2 AND self.code = ?3)",
        ScopedAggregates.numbered("SELECT x FROM A self WHERE (self.user = ?) AND (self.createdOn >= ? AND self.code = ?)"));
  }

  @Test
  void textWithoutPlaceholdersIsUnchanged() {
    assertEquals("SELECT count(self) FROM A self WHERE self.archived = false", ScopedAggregates.numbered("SELECT count(self) FROM A self WHERE self.archived = false"));
  }
}
