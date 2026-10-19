// Renders scripts/support/arabic-sample.html with the HTML-to-PDF stack used by AOS printing
// (Flying Saucer 10 + OpenPDF 3). Evidence for docs/ARABIC_AND_PDF.md.
// java -cp <flying-saucer-core, flying-saucer-pdf, openpdf> FlyingSaucerArabicProbe.java <in.html> <out.pdf> <font.ttf>
import java.io.FileOutputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import org.openpdf.text.pdf.BaseFont;
import org.xhtmlrenderer.pdf.ITextRenderer;

public class FlyingSaucerArabicProbe {
  public static void main(String[] args) throws Exception {
    String html = Files.readString(Path.of(args[0]));
    ITextRenderer renderer = new ITextRenderer();
    renderer.getFontResolver().addFont(args[2], BaseFont.IDENTITY_H, BaseFont.EMBEDDED);
    renderer.setDocumentFromString(html);
    renderer.layout();
    try (FileOutputStream out = new FileOutputStream(args[1])) {
      renderer.createPDF(out);
    }
  }
}
