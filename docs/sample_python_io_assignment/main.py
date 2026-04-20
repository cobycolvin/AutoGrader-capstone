def main():
    inventory = {}

    try:
        command_count = int(input().strip())
    except Exception:
        print("EMPTY")
        print("TOTAL 0")
        return

    for _ in range(command_count):
        try:
            parts = input().strip().split()
        except EOFError:
            break

        if not parts:
            continue

        command = parts[0]

        if command == "ADD":
            sku = parts[1]
            qty = int(parts[2])
            inventory[sku] = inventory.get(sku, 0) + qty

        elif command == "SHIP":
            sku = parts[1]
            qty = int(parts[2])
            current = inventory.get(sku, -1)
            if current >= qty:
                updated = current - qty
                if updated == 0:
                    inventory.pop(sku, None)
                else:
                    inventory[sku] = updated

        elif command == "SET":
            sku = parts[1]
            qty = int(parts[2])
            if qty <= 0:
                inventory.pop(sku, None)
            else:
                inventory[sku] = qty

        elif command == "DELETE":
            sku = parts[1]
            inventory.pop(sku, None)

        elif command == "RENAME":
            old_sku = parts[1]
            new_sku = parts[2]
            if old_sku in inventory:
                qty = inventory.pop(old_sku)
                inventory[new_sku] = inventory.get(new_sku, 0) + qty

    total = 0
    if not inventory:
        print("EMPTY")
    else:
        for sku in sorted(inventory):
            print(f"{sku} {inventory[sku]}")
            total += inventory[sku]

    print(f"TOTAL {total}")


if __name__ == "__main__":
    main()
