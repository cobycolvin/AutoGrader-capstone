class Queue:
    def __init__(self):
        self.items = []

    def push(self, value):
        self.items.append(value)

    def pop(self):
        if not self.items:
            return None
        return self.items.pop(0)
