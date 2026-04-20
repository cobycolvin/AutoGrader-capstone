import java.util.*;

public class Driver {
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        Inventory inv = new Inventory();

        int n = sc.nextInt();
        sc.nextLine(); // consume end line

        for (int i = 0; i < n; i++) {
            String line = sc.nextLine().trim();
            if (line.isEmpty()) continue;
            String[] parts = line.split("\\s+");
            String cmd = parts[0];

            if (cmd.equals("ADD")) {
                inv.add(parts[1], Integer.parseInt(parts[2]));
            } else if (cmd.equals("SHIP")) {
                inv.ship(parts[1], Integer.parseInt(parts[2]));
            } else if (cmd.equals("SET")) {
                inv.set(parts[1], Integer.parseInt(parts[2]));
            }
        }

        System.out.println(inv.report());
    }
}
