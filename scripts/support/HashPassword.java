// Prints an Axelor-compatible password hash (Apache Shiro 2 DefaultPasswordService, argon2id).
// Used by scripts/api_smoke_test.py to create a throw-away test user; run with the Shiro jars on
// the class path: java -cp <jars> scripts/support/HashPassword.java <plain-password>
import org.apache.shiro.authc.credential.DefaultPasswordService;

public class HashPassword {
  public static void main(String[] args) {
    System.out.println(new DefaultPasswordService().encryptPassword(args[0]));
  }
}
