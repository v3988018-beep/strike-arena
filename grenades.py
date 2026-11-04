"""Strike Arena — гранаты.

Полёт считает сервер: гравитация, отскоки от стен, ящиков и пола. Клиенты
получают позиции гранат в каждом снимке и только рисуют их.
"""
import itertools

GRAVITY = 15.0
RADIUS = 0.07                                         # «толщина» гранаты для столкновений
FUSE = {"he": 1.6, "flash": 1.4, "smoke": 1.8}        # через сколько секунд срабатывает
BOUNCE = 0.45                                         # сколько скорости остаётся после удара о стену
FRICTION = 0.75                                       # трение при отскоке от пола

HE_RADIUS, HE_DAMAGE = 9.0, 125
HE_FALLOFF = 1.6   # урон = HE_DAMAGE * (1 - (d/R)^HE_FALLOFF): рядом почти полный, к краю радиуса быстро падает


def he_damage(d):
    """Урон осколочной на расстоянии d (без брони)."""
    return 0.0 if d >= HE_RADIUS else HE_DAMAGE * (1 - (d / HE_RADIUS) ** HE_FALLOFF)
FLASH_RANGE = 30.0
SMOKE_RADIUS, SMOKE_TIME = 3.4, 15.0

_ids = itertools.count(1)


class Nade:
    radius = RADIUS

    def __init__(self, kind, owner, pos, vel, now):
        self.id = next(_ids)
        self.kind = kind
        self.owner = owner            # кто бросил (id игрока)
        self.pos = list(pos)
        self.vel = list(vel)
        self.explode_at = now + FUSE[kind]

    def public(self):
        return {"id": self.id, "kind": self.kind, "pos": [round(v, 2) for v in self.pos]}

    def inside(self, world):
        x, y, z = self.pos
        r = self.radius
        for x0, x1, y0, y1, z0, z1 in world.boxes:
            if x0 - r < x < x1 + r and y0 - r < y < y1 + r and z0 - r < z < z1 + r:
                return True
        return False

    def step(self, world, dt):
        """Сдвиг на dt секунд мелкими шагами; при ударе о стену — отскок."""
        steps = 4
        sub = dt / steps
        for _ in range(steps):
            self.vel[1] -= GRAVITY * sub
            for axis in range(3):
                old = self.pos[axis]
                self.pos[axis] += self.vel[axis] * sub
                if self.inside(world):
                    self.pos[axis] = old
                    self.vel[axis] *= -BOUNCE
                    for other in range(3):
                        if other != axis:
                            self.vel[other] *= 0.8
            if self.pos[1] < self.radius:  # пол
                self.pos[1] = self.radius
                if self.vel[1] < 0:
                    self.vel[1] = -self.vel[1] * 0.4
                self.vel[0] *= FRICTION
                self.vel[2] *= FRICTION


class DroppedGun(Nade):
    """Выброшенное оружие: летит и отскакивает как граната, потом лежит, пока его не подберут."""
    radius = 0.06
    _ids = itertools.count(1)

    def __init__(self, item, owner, pos, vel, yaw, now, ammo=None, skin=None):
        self.id = next(self._ids)
        self.item = item
        self.owner = owner                 # кто выбросил: ему нельзя подобрать сразу же обратно
        self.pos = list(pos)
        self.vel = list(vel)
        self.yaw = yaw                     # куда смотрит ствол, когда лежит
        self.ammo = ammo                   # патроны в магазине и запасе — переходят к тому, кто подобрал
        self.skin = skin
        self.knife = None                  # у выброшенного ножа (item == "knife") — его тип: karambit, m9, ...
        self.born = now
        self.rest = False                  # упало и лежит — физику больше не считаем

    def public(self):
        return {"id": self.id, "item": self.item, "pos": [round(v, 2) for v in self.pos],
                "yaw": round(self.yaw, 2), "rest": self.rest, "skin": self.skin, "knife": self.knife}

    def step(self, world, dt):
        if self.rest:
            return
        super().step(world, dt)
        # почти не движется и опирается на пол или ящик — лежит
        slow = sum(v * v for v in self.vel) < 0.3
        self.pos[1] -= 0.02
        supported = self.pos[1] < self.radius or self.inside(world)
        self.pos[1] += 0.02
        if slow and supported:
            self.rest = True
            self.vel = [0.0, 0.0, 0.0]


def segment_hits_sphere(a, b, center, radius):
    """Проходит ли отрезок a→b через шар (для проверки «сквозь дым не видно»)."""
    d = [b[i] - a[i] for i in range(3)]
    f = [a[i] - center[i] for i in range(3)]
    dd = sum(v * v for v in d) or 1e-9
    t = max(0.0, min(1.0, -sum(f[i] * d[i] for i in range(3)) / dd))
    closest = [a[i] + d[i] * t - center[i] for i in range(3)]
    return sum(v * v for v in closest) < radius * radius
