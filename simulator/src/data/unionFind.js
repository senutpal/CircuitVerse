const INITIAL_RANK = 0;

export default class UnionFind {
    constructor() {
        this.parent = new Map();
        this.rank = new Map();
    }

    ensure(x) {
        if (!this.parent.has(x)) {
            this.parent.set(x, x);
            this.rank.set(x, INITIAL_RANK);
        }
    }

    find(x) {
        this.ensure(x);

        let root = x;
        while (this.parent.get(root) !== root) {
            root = this.parent.get(root);
        }

        let current = x;
        while (current !== root) {
            const next = this.parent.get(current);
            this.parent.set(current, root);
            current = next;
        }

        return root;
    }

    union(x, y) {
        const rootX = this.find(x);
        const rootY = this.find(y);

        if (rootX === rootY) {
            return rootX;
        }

        const rankX = this.rank.get(rootX);
        const rankY = this.rank.get(rootY);

        if (rankX < rankY) {
            this.parent.set(rootX, rootY);
            return rootY;
        } else if (rankX > rankY) {
            this.parent.set(rootY, rootX);
            return rootX;
        } else {
            this.parent.set(rootY, rootX);
            this.rank.set(rootX, rankX + 1);
            return rootX;
        }
    }

    groups() {
        const result = new Map();

        for (const element of this.parent.keys()) {
            const root = this.find(element);

            if (!result.has(root)) {
                result.set(root, []);
            }
            result.get(root).push(element);
        }

        return result;
    }
}
