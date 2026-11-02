"""Запуск: python tools/sightlines.py desert warehouse village canyon

Анализ карт: как рано после старта раунда команды могут увидеть друг друга.

Для каждой клетки навигационной сетки считаем, за сколько секунд до неё добегают от своего спавна
(по пути, со скоростью бега). Потом для пар клеток (своя/чужая) с прямой видимостью на уровне глаз
находим самый ранний момент встречи: max(время_CT, время_T). Чем больше — тем лучше.
"""
import json
import math
import sys
from collections import deque

from pathlib import Path
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from bots import World  # noqa: E402

SPEED = 6.2
EYE = 1.6
LIMIT = 9.0   # дальше этого по времени не считаем


def times_from(world, spawns):
    n = world.n
    dist = [[math.inf] * n for _ in range(n)]
    q = deque()
    for sx, sz in spawns:
        c = world.nearest_free(sx, sz)
        if c:
            dist[c[0]][c[1]] = 0.0
            q.append(c)
    # Дейкстра «на глаз»: BFS с весами 1 / 1.41 — сетка мелкая, хватает
    import heapq
    heap = [(0.0, c) for c in q]
    while heap:
        d, (i, j) = heapq.heappop(heap)
        if d > dist[i][j]:
            continue
        for di in (-1, 0, 1):
            for dj in (-1, 0, 1):
                if not di and not dj:
                    continue
                ni, nj = i + di, j + dj
                if not (0 <= ni < n and 0 <= nj < n) or not world.free[ni][nj]:
                    continue
                if di and dj and not (world.free[i + di][j] and world.free[i][j + dj]):
                    continue
                nd = d + (1.414 if di and dj else 1.0) * 2.0   # клетка 2 м
                if nd < dist[ni][nj]:
                    dist[ni][nj] = nd
                    heapq.heappush(heap, (nd, (ni, nj)))
    return {(i, j): dist[i][j] / SPEED for i in range(n) for j in range(n) if dist[i][j] / SPEED <= LIMIT}


def analyze(path):
    m = json.load(open(path, encoding="utf-8"))
    w = World(m["boxes"])
    tc, tt = times_from(w, m["spawns"]["ct"]), times_from(w, m["spawns"]["t"])
    best = (math.inf, None, None)
    # перебираем по возрастанию времени, чтобы быстро найти раннюю встречу
    ct_cells = sorted(tc.items(), key=lambda kv: kv[1])
    t_cells = sorted(tt.items(), key=lambda kv: kv[1])
    for c1, a in ct_cells:
        if a >= best[0]:
            break
        p1 = (*w.cell_pos(*c1),)
        for c2, b in t_cells:
            t = max(a, b)
            if t >= best[0]:
                break
            p2 = (*w.cell_pos(*c2),)
            if w.los((p1[0], EYE, p1[1]), (p2[0], EYE, p2[1])):
                best = (t, p1, p2)
                break
    # видят ли друг друга прямо со спавнов
    spawn_los = sum(w.los((a[0], EYE, a[1]), (b[0], EYE, b[1]))
                    for a in m["spawns"]["ct"] for b in m["spawns"]["t"])
    # можно ли добежать от спавна до каждой точки закладки и до спавна врага
    reach = all(w.path(m["spawns"]["ct"][0], (s[0], s[1])) for s in m["sites"].values()) and \
        all(w.path(m["spawns"]["t"][0], (s[0], s[1])) for s in m["sites"].values()) and \
        bool(w.path(m["spawns"]["ct"][0], m["spawns"]["t"][0]))
    return best, spawn_los, reach


if __name__ == "__main__":
    for name in sys.argv[1:]:
        (t, p1, p2), spawn_los, reach = analyze(ROOT / "public" / "maps" / f"{name}.json")
        print(f"{name:10s} первая встреча через {t:4.1f} с  (CT {p1} ↔ T {p2})  "
              f"спавн-спавн видно: {spawn_los}  проходимость: {'ok' if reach else 'НЕТ'}")
