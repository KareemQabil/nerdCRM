package com.ioeti.content.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import com.ioeti.core.api.ApiException;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;
import org.junit.jupiter.api.Test;

class FilePolicyTest {

  static final byte[] PDF = "%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n".getBytes(StandardCharsets.US_ASCII);
  static final byte[] PNG = {(byte) 0x89, 'P', 'N', 'G', '\r', '\n', 0x1a, '\n', 0, 0, 0, 13, 'I', 'H', 'D', 'R', 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0};

  static byte[] docx() throws IOException {
    ByteArrayOutputStream out = new ByteArrayOutputStream();
    try (ZipOutputStream zip = new ZipOutputStream(out)) {
      zip.putNextEntry(new ZipEntry("[Content_Types].xml"));
      zip.write("<?xml version=\"1.0\"?><Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\"/>".getBytes(StandardCharsets.UTF_8));
      zip.closeEntry();
      zip.putNextEntry(new ZipEntry("word/document.xml"));
      zip.write("<w:document xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\"/>".getBytes(StandardCharsets.UTF_8));
      zip.closeEntry();
    }
    return out.toByteArray();
  }

  static String code(Runnable check) {
    return assertThrows(ApiException.class, check::run).fieldErrors().get(0).code();
  }

  @Test
  void acceptedFilesKeepTheirExtensionTypeAndChecksum() throws IOException {
    ContentService.Upload pdf = ContentService.check("Proposal v2.PDF", PDF);
    assertEquals("application/pdf", pdf.contentType());
    assertEquals(64, pdf.sha256().length());
    assertEquals("image/png", ContentService.check("stamp.png", PNG).contentType());
    assertEquals("application/vnd.openxmlformats-officedocument.wordprocessingml.document", ContentService.check("عرض فني.docx", docx()).contentType());
    assertEquals("text/plain", ContentService.check("notes.txt", "Meeting notes\nنقاط الاجتماع\n".getBytes(StandardCharsets.UTF_8)).contentType());
  }

  @Test
  void theExtensionAloneIsNotTrusted() {
    assertEquals("TYPE_MISMATCH", code(() -> ContentService.check("invoice.pdf", "MZ\u0090\u0000\u0003 this is a program".getBytes(StandardCharsets.ISO_8859_1))));
    assertEquals("TYPE_MISMATCH", code(() -> ContentService.check("readme.txt", "<html><script>alert(1)</script></html>".getBytes(StandardCharsets.UTF_8))));
    assertEquals("TYPE_MISMATCH", code(() -> ContentService.check("photo.png", PDF)));
    assertEquals("TYPE_NOT_ALLOWED", code(() -> ContentService.check("logo.svg", "<svg xmlns=\"http://www.w3.org/2000/svg\"/>".getBytes(StandardCharsets.UTF_8))));
    assertEquals("TYPE_NOT_ALLOWED", code(() -> ContentService.check("run.exe", PDF)));
    assertEquals("TYPE_NOT_ALLOWED", code(() -> ContentService.check("noextension", PDF)));
  }

  @Test
  void emptyAndOversizedFilesAreRefused() {
    assertEquals("REQUIRED", code(() -> ContentService.check("a.pdf", new byte[0])));
    byte[] big = new byte[ContentService.MAX_BYTES + 1];
    System.arraycopy(PDF, 0, big, 0, PDF.length);
    assertEquals("TOO_LARGE", code(() -> ContentService.check("a.pdf", big)));
  }

  @Test
  void fileNamesLoseTheirPathAndReservedCharacters() {
    assertEquals("passwd.txt", ContentService.cleanFileName("../../etc/passwd.txt"));
    assertEquals("report.pdf", ContentService.cleanFileName("C:\\Users\\x\\report.pdf"));
    assertEquals("evilname.pdf", ContentService.cleanFileName("evil<>:\"|?*\u0000name.pdf"));
    assertEquals("hidden.pdf", ContentService.cleanFileName(".hidden.pdf"));
    String longName = "a".repeat(200) + ".pdf";
    assertEquals(120, ContentService.cleanFileName(longName).length());
    assertEquals(".pdf", ContentService.cleanFileName(longName).substring(116));
    assertEquals("REQUIRED", code(() -> ContentService.cleanFileName("../")));
  }

  @Test
  void subjectsUseStableNames() {
    assertEquals(4, ContentService.subject("QUOTE"));
    assertEquals("subject", assertThrows(ApiException.class, () -> ContentService.subject("INVOICE")).fieldErrors().get(0).field());
  }
}
