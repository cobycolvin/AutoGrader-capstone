import java.util.*;

public class Inventory {
    private final Map<String, Integer> stock = new HashMap<>();

    public void add(String sku, int qty) {
        int current = stock.containsKey(sku) ? stock.get(sku) : 0;
        stock.put(sku, current + qty);
    }

    public void ship(String sku, int qty) {
        Integer current = stock.get(sku);
        if (current == null) return;
        int updated = current - qty;
        if (updated <= 0) stock.remove(sku);
        else stock.put(sku, updated);
    }

    public void set(String sku, int qty) {
        if (qty <= 0) {
            stock.remove(sku);
        } else {
            stock.put(sku, qty);
        }
    }

    public String report() {
        List<String> keys = new ArrayList<>(stock.keySet());
        Collections.sort(keys);
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < keys.size(); i++) {
            String k = keys.get(i);
            sb.append(k).append(" ").append(stock.get(k));
            if (i < keys.size() - 1) sb.append("\n");
        }
        return sb.toString();
    }
}
