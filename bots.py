"""Strike Arena — боты.

World  — знание карты: где можно ходить (сетка 2×2 м), поиск пути A*,
         проверка прямой видимости и столкновений.
BotBrain — поведение одного бота: бродит по карте, замечает врагов в поле
         зрения, реагирует на выстрелы и попадания, стреляет очередями.
"""
import heapq
import math
import random

CELL = 2.0               # размер клетки навигационной сетки
HALF = 40.0              # карта от -40 до 40
RADIUS = 0.35            # «толщина» игрока
BOT_SPEED = 5.6          # бегут чуть медленнее живого игрока (6.2) — и их шаги слышно
STRAFE_SPEED = 2.6
EYE, CROUCH_EYE = 1.6, 1.15
FIRE_INTERVAL = 0.1      # как у AKR на клиенте
# Как бот стреляет из разного оружия: пауза между выстрелами, очередями ли, множитель точности
BOT_GUNS = {
    "rifle":  {"interval": 0.1,  "burst": True,  "acc": 1.0},
    "awp":    {"interval": 1.5,  "burst": False, "acc": 1.25},
    "pistol": {"interval": 0.18, "burst": False, "acc": 0.8},
    "deagle": {"interval": 0.32, "burst": False, "acc": 0.9},
    "m4":     {"interval": 0.09, "burst": True,  "acc": 1.05},
    "smg":    {"interval": 0.075, "burst": True, "acc": 0.85},
    "shotgun": {"interval": 0.95, "burst": False, "acc": 1.0, "pellets": 6, "close": 15},  # дробь — только вблизи
}
MAG = 30
RELOAD = 2.2
VIEW_DIST = 70
HALF_FOV = math.radians(110) / 2
HEAR_DIST = 30           # на каком расстоянии боты слышат выстрелы

DIFFICULTY = {
    #           реакция (сек)   точность  в голову  поворот (рад/с)
    "easy":   {"react": (0.6, 1.0),  "acc": 0.30, "head": 0.08, "turn": 4.0},
    "normal": {"react": (0.35, 0.65), "acc": 0.50, "head": 0.15, "turn": 7.0},
    "hard":   {"react": (0.18, 0.35), "acc": 0.72, "head": 0.28, "turn": 11.0},
    "expert": {"react": (0.10, 0.20), "acc": 0.85, "head": 0.40, "turn": 16.0},
}
DIFFICULTY_NAME = {"easy": "лёгкая", "normal": "средняя", "hard": "сложная", "expert": "эксперт"}

BOT_NAMES = ["Артём", "Макс", "Никита", "Даня", "Илья", "Кирилл", "Егор", "Матвей",
             "Тимур", "Лёва", "Саня", "Глеб", "Ваня", "Рома", "Миша", "Федя"]


def yaw_to(dx, dz):
    """Угол поворота, при котором взгляд (-sin yaw, -cos yaw) смотрит на (dx, dz)."""
    return math.atan2(-dx, -dz)


def angle_diff(a, b):
    return math.atan2(math.sin(a - b), math.cos(a - b))


class World:
    def __init__(self, boxes):
        # AABB: (minX, maxX, minY, maxY, minZ, maxZ); 7-е число ящика — высота основания (крыши, перемычки)
        self.boxes = []
        for b in boxes:
            x, z, w, d, h = b[:5]
            y0 = b[6] if len(b) > 6 else 0.0
            self.boxes.append((x - w / 2, x + w / 2, y0, y0 + h, z - d / 2, z + d / 2))
        # мешают ходить только то, что стоит на земле (под крышей и перемычкой двери можно пройти)
        self.walls = [b for b in self.boxes if b[2] < 1.5]
        self.n = int(2 * HALF / CELL)
        margin = RADIUS + 0.3
        self.free = [[self.point_free(*self.cell_pos(i, j), margin) for j in range(self.n)]
                     for i in range(self.n)]

    # ---------- сетка ----------
    def cell_pos(self, i, j):
        return (-HALF + CELL / 2 + i * CELL, -HALF + CELL / 2 + j * CELL)

    def cell_of(self, x, z):
        i = int((x + HALF) // CELL)
        j = int((z + HALF) // CELL)
        return min(max(i, 0), self.n - 1), min(max(j, 0), self.n - 1)

    def point_free(self, x, z, margin=RADIUS):
        if abs(x) > HALF - 0.5 - margin or abs(z) > HALF - 0.5 - margin:
            return False
        for x0, x1, _, _, z0, z1 in self.walls:
            if x0 - margin < x < x1 + margin and z0 - margin < z < z1 + margin:
                return False
        return True

    def nearest_free(self, x, z):
        ci, cj = self.cell_of(x, z)
        best, best_d = None, 1e9
        for r in range(6):
            for i in range(ci - r, ci + r + 1):
                for j in range(cj - r, cj + r + 1):
                    if 0 <= i < self.n and 0 <= j < self.n and self.free[i][j]:
                        px, pz = self.cell_pos(i, j)
                        d = (px - x) ** 2 + (pz - z) ** 2
                        if d < best_d:
                            best, best_d = (i, j), d
            if best:
                return best
        return None

    def path(self, start, goal):
        """A* по сетке. Возвращает список точек (x, z) до цели."""
        s, g = self.nearest_free(*start), self.nearest_free(*goal)
        if not s or not g:
            return []
        heap = [(0.0, 0, s)]
        came = {s: None}
        cost = {s: 0.0}
        counter = 0
        while heap:
            _, _, cur = heapq.heappop(heap)
            if cur == g:
                break
            ci, cj = cur
            for di in (-1, 0, 1):
                for dj in (-1, 0, 1):
                    if not di and not dj:
                        continue
                    ni, nj = ci + di, cj + dj
                    if not (0 <= ni < self.n and 0 <= nj < self.n) or not self.free[ni][nj]:
                        continue
                    # по диагонали — только если не срезаем угол стены
                    if di and dj and not (self.free[ci + di][cj] and self.free[ci][cj + dj]):
                        continue
                    nc = cost[cur] + (1.414 if di and dj else 1.0)
                    if nc < cost.get((ni, nj), 1e9):
                        cost[(ni, nj)] = nc
                        came[(ni, nj)] = cur
                        h = math.hypot(ni - g[0], nj - g[1])
                        counter += 1
                        heapq.heappush(heap, (nc + h, counter, (ni, nj)))
        if g not in came:
            return []
        cells = []
        node = g
        while node:
            cells.append(self.cell_pos(*node))
            node = came[node]
        cells.reverse()
        return cells

    # ---------- геометрия ----------
    def walk_clear(self, a, b):
        """Можно ли пройти по прямой из a в b (x, z)."""
        dist = math.hypot(b[0] - a[0], b[1] - a[1])
        steps = int(dist / 0.4) + 1
        for k in range(1, steps + 1):
            t = k / steps
            if not self.point_free(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, RADIUS + 0.1):
                return False
        return True

    def los(self, a, b):
        """Прямая видимость между точками a и b (x, y, z): никакой ящик не мешает."""
        d = (b[0] - a[0], b[1] - a[1], b[2] - a[2])
        for box in self.boxes:
            tmin, tmax = 0.0, 1.0
            for axis in range(3):
                lo, hi = box[axis * 2], box[axis * 2 + 1]
                p, v = a[axis], d[axis]
                if abs(v) < 1e-9:
                    if p < lo or p > hi:
                        break
                    continue
                t1, t2 = (lo - p) / v, (hi - p) / v
                if t1 > t2:
                    t1, t2 = t2, t1
                tmin, tmax = max(tmin, t1), min(tmax, t2)
                if tmin > tmax:
                    break
            else:
                return False  # отрезок проходит через ящик
        return True

    def collide(self, x, z):
        """Выталкивает точку из стен."""
        for x0, x1, _, _, z0, z1 in self.walls:
            x0, x1, z0, z1 = x0 - RADIUS, x1 + RADIUS, z0 - RADIUS, z1 + RADIUS
            if x0 < x < x1 and z0 < z < z1:
                pushes = [(x - x0, (x0, z)), (x1 - x, (x1, z)), (z - z0, (x, z0)), (z1 - z, (x, z1))]
                x, z = min(pushes)[1]
        lim = HALF - 0.5 - RADIUS
        return min(max(x, -lim), lim), min(max(z, -lim), lim)


class BotBrain:
    def __init__(self):
        self.reset()

    def reset(self):
        self.path = []
        self.goal = None
        self.target = None
        self.react_until = 0.0
        self.next_shot = 0.0
        self.mag = MAG
        self.reload_until = 0.0
        self.burst = 0
        self.burst_len = random.randint(3, 7)
        self.alert_pos = None
        self.alert_until = 0.0
        self.blind_until = 0.0     # ослеплён флешкой
        self.strafe = random.choice((-1, 1))
        self.strafe_until = 0.0
        self.stuck_at = 0.0
        self.stuck_pos = None

    def alert(self, pos, now, seconds=4.0):
        """Услышал выстрел или получил урон — повернётся и пойдёт проверять."""
        self.alert_pos = (pos[0], pos[2])
        self.alert_until = now + seconds
        self.path = []
        self.goal = None

    # ---------- главный цикл ----------
    async def update(self, me, game, now, dt):
        if not me.alive or game.phase == "freeze":
            return
        diff = DIFFICULTY[game.difficulty]
        eye = CROUCH_EYE if me.crouch else EYE
        target = self.find_target(me, game, now, eye)
        if target:
            game.set_using(me, False)  # увидел врага — бросает закладку/разминирование
            await self.fight(me, target, game, diff, now, dt, eye)
            return
        self.target = None
        me.crouch = False
        objective = game.objective_for(me)  # режим бомбы: заложить, подобрать, прикрыть, разминировать
        if objective:
            self.pursue(me, game, objective, now, dt)
        else:
            game.set_using(me, False)
            self.roam(me, game, now, dt)

    def pursue(self, me, game, objective, now, dt):
        (gx, gz), action, ready, *center = objective
        if action and ready:
            me.pitch = -0.5          # смотрит вниз, на бомбу
            game.set_using(me, True)  # держит E
            return
        game.set_using(me, False)
        me.pitch *= 0.9
        if math.hypot(gx - me.pos[0], gz - me.pos[2]) < 1.2:
            # на месте: прикрывает — смотрит наружу, откуда придут враги, и водит взглядом; иногда приседает
            if action == "guard" and center:
                cx, cz = center[0]
                out = yaw_to(me.pos[0] - cx, me.pos[2] - cz)
                self.turn_to(me, out + 0.9 * math.sin(now * 0.7 + me.id), 2.5, dt)
                me.crouch = (int(now / 4) + me.id) % 3 == 0
            return
        if self.goal is None or math.hypot(self.goal[0] - gx, self.goal[1] - gz) > 1.0 or not self.path:
            self.goal = (gx, gz)
            self.path = game.world.path((me.pos[0], me.pos[2]), (gx, gz))
            if not self.path:
                return
        self.follow(me, game.world, now, dt)

    def visible(self, me, other, game, eye):
        """Видно ли врага: не мешают стены и дым."""
        a = (me.pos[0], me.pos[1] + eye, me.pos[2])
        for h in ((1.17 if other.crouch else 1.62), (0.8 if other.crouch else 1.15)):  # голова, грудь
            b = (other.pos[0], other.pos[1] + h, other.pos[2])
            if game.world.los(a, b) and not game.smoke_blocks(a, b):
                return True
        return False

    def find_target(self, me, game, now, eye):
        if now < self.blind_until:
            return None  # ослеплён флешкой — никого не видит
        alerted = now < self.alert_until
        best, best_d = None, 1e9
        for p in game.players.values():
            if not p.alive or p.team == me.team:
                continue
            dx, dz = p.pos[0] - me.pos[0], p.pos[2] - me.pos[2]
            dist = math.hypot(dx, dz)
            if dist > VIEW_DIST:
                continue
            # уже ведёт этого врага или насторожен — замечает в любом направлении
            if p.id != self.target and not alerted and abs(angle_diff(yaw_to(dx, dz), me.yaw)) > HALF_FOV:
                continue
            if not self.visible(me, p, game, eye):
                continue
            score = dist * (0.5 if p.id == self.target else 1.0)
            if score < best_d:
                best, best_d = p, score
        return best

    def turn_to(self, me, yaw, speed, dt):
        d = angle_diff(yaw, me.yaw)
        step = speed * dt
        me.yaw += max(-step, min(step, d))
        return d

    def move(self, me, world, dx, dz, step):
        x, z = world.collide(me.pos[0] + dx * step, me.pos[2] + dz * step)
        me.pos = [x, 0.0, z]

    # ---------- бой ----------
    async def fight(self, me, target, game, diff, now, dt, eye):
        if self.target != target.id:
            self.target = target.id
            self.react_until = now + random.uniform(*diff["react"])
            me.crouch = random.random() < 0.3
        self.alert_until = 0
        dx, dz = target.pos[0] - me.pos[0], target.pos[2] - me.pos[2]
        dist = math.hypot(dx, dz)
        aim_err = self.turn_to(me, yaw_to(dx, dz), diff["turn"], dt)
        ty = target.pos[1] + (0.85 if target.crouch else 1.2)
        me.pitch = math.atan2(ty - (me.pos[1] + eye), max(dist, 0.1))

        # стрейф (шаги вбок) во время перестрелки
        if not me.crouch:
            if now > self.strafe_until:
                self.strafe = -self.strafe
                self.strafe_until = now + random.uniform(0.4, 1.1)
            rx, rz = math.cos(me.yaw), -math.sin(me.yaw)
            self.move(me, game.world, rx * self.strafe, rz * self.strafe, STRAFE_SPEED * dt)

        if now < self.reload_until or now < self.react_until or now < self.next_shot or abs(aim_err) > 0.2:
            return
        await self.fire(me, target, game, diff, now, dist, eye)

    async def fire(self, me, target, game, diff, now, dist, eye):
        gun = BOT_GUNS.get(me.weapon, BOT_GUNS["rifle"])
        self.burst += 1
        if gun["burst"] and self.burst >= self.burst_len:
            self.burst = 0
            self.burst_len = random.randint(3, 7)
            self.next_shot = now + random.uniform(0.25, 0.55)
        else:
            self.next_shot = now + gun["interval"] * random.uniform(1.0, 1.3)
        self.mag -= 1
        if self.mag <= 0:
            self.reload_until = now + RELOAD
            self.mag = MAG

        chance = diff["acc"] * gun["acc"] * max(0.2, 1 - dist / 85)
        if self.burst > 4:
            chance *= 0.6           # длинная очередь уводит прицел
        if target.crouch:
            chance *= 0.85
        if not me.crouch:
            chance *= 0.85          # стреляет на ходу
        hit = random.random() < chance
        head = hit and random.random() < diff["head"]

        if head:
            ty = 1.17 if target.crouch else 1.62
        else:
            ty = 0.8 if target.crouch else 1.15
        end = [target.pos[0], target.pos[1] + ty, target.pos[2]]
        if not hit:
            end = [end[0] + random.uniform(-1.2, 1.2), end[1] + random.uniform(-0.6, 0.6),
                   end[2] + random.uniform(-1.2, 1.2)]
        fx, fz = -math.sin(me.yaw), -math.cos(me.yaw)
        start = [me.pos[0] + fx * 0.6 + math.cos(me.yaw) * 0.2, me.pos[1] + eye - 0.3,
                 me.pos[2] + fz * 0.6 - math.sin(me.yaw) * 0.2]
        await game.broadcast({"type": "shot", "id": me.id, "from": start, "to": end})
        game.noise(me)
        if hit:
            # дробовик вблизи попадает несколькими дробинами, издалека — одной
            pellets = gun.get("pellets", 1) if dist < gun.get("close", 99) else 1
            for i in range(pellets):
                await game.handle_hit(me, {"target": target.id, "head": head and i == 0})

    # ---------- передвижение ----------
    def pick_goal(self, me, game):
        enemy = "t" if me.team == "ct" else "ct"
        if random.random() < 0.4:
            sx, sz = random.choice(game.spawns[enemy])
            goal = (sx, sz)
        else:
            goal = tuple(random.choice(game.points))
        self.goal = goal
        self.path = game.world.path((me.pos[0], me.pos[2]), goal)

    def roam(self, me, game, now, dt):
        world = game.world
        me.pitch *= 0.9
        if self.alert_pos and now < self.alert_until:
            ax, az = self.alert_pos
            if math.hypot(ax - me.pos[0], az - me.pos[2]) < 2:
                self.alert_until = 0   # дошёл — никого нет, снова бродит
                return
            # сначала поворачивается на звук, потом идёт туда
            if abs(self.turn_to(me, yaw_to(ax - me.pos[0], az - me.pos[2]), 6.0, dt)) > 0.3:
                return
            if self.goal != self.alert_pos:
                self.goal = self.alert_pos
                self.path = world.path((me.pos[0], me.pos[2]), self.alert_pos)
        if not self.path:
            self.pick_goal(me, game)
            if not self.path:
                return
        self.follow(me, world, now, dt)

    def follow(self, me, world, now, dt):
        """Идёт по найденному пути (self.path)."""
        pos = (me.pos[0], me.pos[2])
        while len(self.path) > 1 and world.walk_clear(pos, self.path[1]):
            self.path.pop(0)   # срезаем путь по прямой, где можно
        nx, nz = self.path[0]
        dx, dz = nx - pos[0], nz - pos[1]
        dist = math.hypot(dx, dz)
        if dist < 0.6:
            self.path.pop(0)
            return
        self.turn_to(me, yaw_to(dx, dz), 8.0, dt)
        self.move(me, world, dx / dist, dz / dist, BOT_SPEED * dt)

        # застрял — ищет другую цель
        if now > self.stuck_at:
            if self.stuck_pos and math.hypot(me.pos[0] - self.stuck_pos[0], me.pos[2] - self.stuck_pos[1]) < 0.5:
                self.path = []
                self.goal = None
            self.stuck_pos = (me.pos[0], me.pos[2])
            self.stuck_at = now + 1.5
