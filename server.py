"""Strike Arena — сервер игры.

Раздаёт файлы из папки public/ и держит WebSocket /ws для мультиплеера.
Запуск:  python server.py   (потом открыть http://localhost:8080)
"""
import asyncio
import hmac
import json
import math
import os
import random
import socket
import sys
import time
from pathlib import Path

from aiohttp import web, WSMsgType

from bots import World, BotBrain, BOT_NAMES, DIFFICULTY, DIFFICULTY_NAME, HEAR_DIST
from grenades import (Nade, DroppedGun, segment_hits_sphere, HE_RADIUS, he_damage, FLASH_RANGE,
                      SMOKE_RADIUS, SMOKE_TIME)
import economy
import social as social_mod
from social import Social, rank_of

GOLD = economy.REWARDS["game"]   # золото за убийство, помощь, раунд, MVP, матч

# На хостинге (Render и т.п.) порт задаёт сам хостинг через переменную PORT — это и признак «сервер в интернете»
HOSTED = "PORT" in os.environ
PORT = int(os.environ.get("PORT", 8080))
# Секретный ключ владельца для читов на сервере в интернете (переменная OWNER_KEY в настройках хостинга).
# Номер профиля там не годится: у незнакомца может оказаться такой же
OWNER_KEY = os.environ.get("OWNER_KEY", "")
MAX_TEAM = 6              # максимум игроков в команде (люди + боты)
DEFAULT_BOTS = 6          # до скольких игроков боты добивают каждую команду
TICK_RATE = 20            # сколько раз в секунду сервер рассылает состояние
RESPAWN_TIME = 3.0        # секунд до возрождения (только в разминке)
FREEZE_TIME = 3.0         # заморозка в начале раунда
ROUND_TIME = 115.0        # длительность раунда
ROUND_END_TIME = 4.0      # пауза после раунда
MATCH_END_TIME = 7.0      # пауза после матча
ROUNDS_TO_WIN = 8         # раундов для победы в матче
MAX_HP = 100
# Правила игры. Скорость, прыжок и гравитация применяются у игрока в браузере,
# остальное — на сервере. weapons: "buy" — обычная закупка, иначе у всех только это оружие
DEFAULT_RULES = {"speed": 1.0, "jump": 1.0, "gravity": 1.0, "hp": MAX_HP, "rounds": ROUNDS_TO_WIN,
                 "weapons": "buy", "headshot": False, "money": "normal", "nades": True}
WALLBANG_MUL = 0.6        # урон сквозь ящик

# Режим «Закладка бомбы»
BOMB_TIME = 40.0          # секунд от закладки до взрыва
PLANT_TIME = 3.0          # сколько держать E, чтобы заложить
DEFUSE_TIME = 7.0         # сколько держать E, чтобы разминировать
DEFUSE_RANGE = 2.0        # с какого расстояния можно разминировать
PICKUP_RANGE = 1.3        # с какого расстояния террорист подбирает упавшую бомбу
BLAST_RADIUS = 18.0       # радиус взрыва
BLAST_DAMAGE = 220        # урон в центре взрыва (дальше — меньше)
MODES = ("bomb", "tdm")   # закладка бомбы / командный бой

# Урон оружия: (по телу, по голове)
WEAPONS = {
    "rifle": (27, 100),    # AKR
    "awp": (115, 400),     # снайперская — убивает с одного попадания в тело
    "pistol": (20, 60),    # USP (есть у всех)
    "deagle": (53, 170),   # Desert Eagle
    "m4": (24, 92),        # M4: слабее AKR, зато точнее
    "smg": (19, 60),       # MP5: быстрый и дешёвый, слабый на дальности
    "shotgun": (20, 45),   # Nova: урон одной дробины (их 8 за выстрел)
    "knife": (50, 50),
}
GUNS = ("rifle", "awp", "pistol", "deagle", "m4", "smg", "shotgun")
PRIMARY = ("rifle", "awp", "m4", "smg", "shotgun")   # основное оружие (слот 1), остальное — пистолеты
slot_of = lambda item: "primary" if item in PRIMARY else "secondary"
# Броня: какая доля урона проходит сквозь бронежилет (тело) и шлем (голова)
ARMOR_BODY = {"rifle": 0.78, "awp": 0.97, "pistol": 0.5, "deagle": 0.9, "m4": 0.7, "smg": 0.6, "shotgun": 0.5,
              "knife": 0.85, "he": 0.6}
ARMOR_HEAD = {"rifle": 1.0, "awp": 1.0, "pistol": 0.5, "deagle": 1.0, "m4": 1.0, "smg": 0.7, "shotgun": 0.8, "knife": 1.0}

# ---------- Экономика (как в CS) ----------
START_MONEY = 800
MAX_MONEY = 16000
BUY_TIME = 20.0           # сколько секунд после заморозки ещё можно покупать
KILL_REWARD = {"rifle": 300, "awp": 100, "pistol": 300, "deagle": 300, "m4": 300, "smg": 600, "shotgun": 900,
               "knife": 1500, "he": 300}
WIN_REWARD = {"elimination": 3250, "time": 3250, "bomb": 3500, "defuse": 3500}
LOSS_REWARD = [1400, 1900, 2400, 2900, 3400]   # за проигрыш подряд: 1-й, 2-й, ...
PLANT_BONUS = 800         # террористам, если бомба была заложена, но раунд проигран
ASSIST_DAMAGE = 40        # сколько урона нужно нанести жертве, чтобы засчитали помощь
SHOP = {                  # что продаётся: цена и куда кладётся
    "deagle": (700, "secondary"), "pistol": (200, "secondary"),
    "rifle": (2700, "primary"), "awp": (4750, "primary"), "m4": (3100, "primary"),
    "smg": (1500, "primary"), "shotgun": (1200, "primary"),
    "kevlar": (650, "armor"), "helmet": (1000, "armor"),
    "he": (300, "nade"), "smoke": (300, "nade"), "flash": (200, "nade"),
}
NADES = ("he", "smoke", "flash")
# Нож: быстрый удар (ЛКМ) и сильный укол (ПКМ); дальше MELEE_RANGE не достаёт
KNIFE_DMG = {"slash": 50, "stab": 90}
MELEE_RANGE = 2.6
# Профили, которым разрешены «читы» (аим и ВХ) — только владелец сервера. Пока они включены,
# у игрока в таблице и в килфиде всем видна метка 🛠
CHEAT_PROFILES = {"6304"}   # только дома; в интернете — по OWNER_KEY (см. cheats_allowed)


def cheats_allowed(pid, key):
    if HOSTED:
        if not (OWNER_KEY and isinstance(key, str)):
            return False
        # ключ мог прийти из адреса с «+», превращённым в пробел, — такой тоже принимаем
        key = key.strip().replace(" ", "+")
        return hmac.compare_digest(key.encode(), OWNER_KEY.strip().encode())
    return pid in CHEAT_PROFILES
KNIVES = ("default", "karambit", "butterfly", "skeleton", "stiletto", "m9")
KNIFE_UNLOCK = {"default": 0, "stiletto": 50, "skeleton": 100, "karambit": 150, "butterfly": 200, "m9": 250}  # убийств до открытия

TEAM_NAME = {"ct": "Спецназ", "t": "Террористы"}

PUBLIC_DIR = Path(__file__).parent / "public"

# Карта общая с клиентом: стены, точки возрождения, точки для ботов
#   (общие с клиентом файлы public/maps/*.json, собираются скриптом tools/build_maps.py)
MAPS = {f.stem: json.loads(f.read_text(encoding="utf-8"))
        for f in sorted((PUBLIC_DIR / "maps").glob("*.json")) if f.stem != "index"}
DEFAULT_MAP = "desert"
TEAMS = ("ct", "t")


def dist2d(a, b):
    return ((a[0] - b[0]) ** 2 + (a[-1] - b[-1]) ** 2) ** 0.5


class Player:
    def __init__(self, pid, name, team, ws, brain=None):
        self.id = pid
        self.name = name
        self.team = team
        self.ws = ws          # у ботов None
        self.brain = brain    # у людей None
        self.pid = None       # id профиля (для статистики), у ботов None
        self.cheats = False   # включены ли аим/ВХ — видно всем
        self.cheat_ok = False # разрешены ли читы этому игроку (см. cheats_allowed)
        self.headshots = 0    # за матч — для итогов
        self.match_xp = 0     # опыт за матч — для итогов
        self.pos = [0.0, 0.0, 0.0]
        self.yaw = 0.0
        self.pitch = 0.0
        self.hp = MAX_HP
        self.alive = True
        self.kills = 0
        self.deaths = 0
        self.weapon = "pistol"
        self.knife = "default"   # какой нож выбран в меню
        self.skins = {}          # надетые скины: {оружие: id скина} — чтобы другие видели
        # снаряжение: деньги, основное оружие, пистолет, броня (0 — нет, 1 — жилет, 2 — жилет+шлем), гранаты
        self.money = START_MONEY
        self.reset_loadout()
        self.round_kills = 0     # убийств в текущем раунде (для MVP)
        self.mvps = 0            # сколько раз был MVP раунда в этом матче
        self.assists = 0         # помощь в убийствах
        self.dmg_from = {}       # кто сколько урона нанёс мне в этой жизни (для помощи)
        self.flashed_by = None   # кто ослепил и до какого времени: (id, до)
        self.blind_until = 0.0   # до какого времени ослеплён (для убийства вслепую)
        self.crouch = False
        self.respawn_at = 0.0
        # зажата E (закладка / разминирование): с какого момента и откуда
        self.using = False
        self.use_start = 0.0
        self.use_pos = [0.0, 0.0, 0.0]
        # купленное в этом раунде: предмет → (сколько заплатил, что было в этом слоте до покупки).
        # Пока идёт закупка, это можно продать за полную цену
        self.bought = {}

    def reset_loadout(self):
        """Погиб — в новом раунде только стандартный пистолет и нож."""
        self.primary = None
        self.secondary = "pistol"
        self.armor = 0
        self.nades = {n: 0 for n in NADES}

    def owns(self, item):
        if not item:
            return False
        return item in (self.primary, self.secondary, "knife") or self.nades.get(item, 0) > 0

    def sellable(self):
        """Что можно продать: купленное в этом раунде и всё ещё при себе."""
        out = []
        for item in self.bought:
            kind = SHOP[item][1]
            if kind == "armor":
                owned = self.armor == (2 if item == "helmet" else 1)
            elif kind == "nade":
                owned = self.nades.get(item, 0) > 0
            else:
                owned = getattr(self, kind) == item
            if owned:
                out.append(item)
        return out

    def inventory(self):
        return {"money": self.money, "primary": self.primary, "secondary": self.secondary,
                "armor": self.armor, "nades": self.nades, "sellable": self.sellable()}

    def public(self):
        return {
            "id": self.id, "name": self.name, "team": self.team,
            "pos": self.pos, "yaw": self.yaw, "pitch": self.pitch,
            "hp": self.hp, "alive": self.alive, "weapon": self.weapon, "knife": self.knife,
            "kills": self.kills, "deaths": self.deaths, "crouch": self.crouch,
            "bot": self.brain is not None, "mvps": self.mvps, "armor": self.armor, "assists": self.assists,
            "money": self.money, "skins": self.skins,
            "profile": self.pid,   # номер профиля — по нему открывают профиль и добавляют в друзья
            "cheats": self.cheats,
        }


class Game:
    def __init__(self):
        self.players: dict[int, Player] = {}
        self.next_id = 1
        self.score = {"ct": 0, "t": 0}
        # warmup — одна из команд пустая, возрождение сразу;
        # freeze — заморозка; live — идёт раунд; end — пауза между раундами
        self.phase = "warmup"
        self.phase_end = 0.0
        self.round = 0
        # боты
        self.set_map(DEFAULT_MAP)
        self.bot_fill = DEFAULT_BOTS
        self.difficulty = "normal"
        self.solo = False     # личная оффлайн-игра с ботами
        self.room = "public"
        self.task = None
        self.mode = "bomb"
        # бомба: state — carried / dropped / planted / defused / exploded
        self.bomb = None
        self.bomb_phys = None     # брошенная бомба в полёте/на земле (физика как у выброшенного оружия)
        self.bomb_action = None   # кто сейчас закладывает или разминирует: {id, kind, frac}
        self.loss_streak = {"ct": 0, "t": 0}   # сколько раундов подряд команда проиграла
        self.live_since = 0.0                  # когда закончилась заморозка (для времени покупки)
        self.nades = []                        # летящие гранаты
        self.guns = []                         # оружие на земле (выброшенное на G или выпавшее из убитых)
        self.team_size = {}                    # сколько было игроков в командах в начале раунда (для «эйса»)
        self.smokes = []                       # дымовые облака: {pos, until}
        # правила: в обычной игре стандартные, в лобби 1 на 1 их задаёт хозяин лобби
        self.rules = dict(DEFAULT_RULES)
        self.lobby = None                      # код лобби, если это игра лобби
        self.lobby_teams = {}                  # id профиля → команда (в лобби)

    def set_map(self, map_id):
        """Карта этой игры: стены для ботов, точки возрождения, точки закладки."""
        self.map_id = map_id
        m = MAPS[map_id]
        self.world = World(m["boxes"])
        self.spawns = {team: [tuple(p) for p in pts] for team, pts in m["spawns"].items()}
        self.sites = {name: tuple(v) for name, v in m["sites"].items()}  # (x, z, радиус)
        self.points = m["points"]

    async def change_map(self, map_id):
        """Смена карты в идущей игре: новый матч на новой карте."""
        self.set_map(map_id)
        self.score = {"ct": 0, "t": 0}
        self.round = 0
        self.bomb = None
        self.guns.clear()
        for p in self.players.values():
            p.kills = p.deaths = p.mvps = p.assists = 0
        await self.broadcast({"type": "mapChange", "map": map_id})
        for p in self.players.values():
            await self.respawn(p)
        self.set_phase("warmup", 0)  # со следующего тика начнётся первый раунд

    # ---------- вспомогательное ----------
    def humans(self, team=None):
        return [p for p in self.players.values() if not p.brain and (team is None or p.team == team)]

    def pick_team(self):
        ct, t = len(self.humans("ct")), len(self.humans("t"))
        if ct == t:
            return random.choice(["ct", "t"])
        return "ct" if ct < t else "t"

    def count(self, team, alive_only=False):
        return sum(1 for p in self.players.values()
                   if p.team == team and (p.alive or not alive_only))

    def teams_ready(self):
        return self.count("ct") > 0 and self.count("t") > 0

    def spawn(self, p: Player):
        # свободная точка возрождения (чтобы 6 игроков не стояли друг в друге)
        taken = [q.pos for q in self.players.values() if q is not p and q.team == p.team and q.alive]
        spots = self.spawns[p.team][:]
        random.shuffle(spots)
        x, z = min(spots, key=lambda s: -min((abs(s[0] - q[0]) + abs(s[1] - q[2]) for q in taken), default=99))
        # небольшой разброс, чтобы не стоять друг в друге — но никогда не внутри стены или ящика
        for _ in range(12):
            px, pz = x + random.uniform(-0.8, 0.8), z + random.uniform(-0.8, 0.8)
            if self.world.point_free(px, pz):
                break
        else:
            px, pz = x, z
        p.pos = [px, 0.0, pz]
        if p.brain:
            p.brain.reset()
        p.yaw = -2.356 if p.team == "ct" else 0.785  # смотрят в сторону центра
        p.pitch = 0.0
        p.hp = self.rules["hp"]
        p.alive = True
        p.crouch = False
        p.dmg_from = {}
        p.flashed_by = None
        p.blind_until = 0.0

    def kill_off(self, p: Player):
        """Игрок выбывает до следующего раунда (или на RESPAWN_TIME в разминке)."""
        p.alive = False
        p.using = False
        p.respawn_at = time.time() + RESPAWN_TIME if self.phase == "warmup" else float("inf")
        self.drop_bomb(p)

    async def send(self, p: Player, msg):
        if p.ws is None:
            return
        try:
            await p.ws.send_str(json.dumps(msg))
        except Exception:
            pass

    async def broadcast(self, msg, exclude=None):
        data = json.dumps(msg)
        for p in list(self.players.values()):
            if p.id == exclude or p.ws is None:
                continue
            try:
                await p.ws.send_str(data)
            except Exception:
                pass

    async def respawn(self, p: Player):
        self.spawn(p)
        await self.send(p, {"type": "respawn", "pos": p.pos, "yaw": p.yaw})

    # ---------- бой ----------
    async def handle_hit(self, shooter: Player, data):
        target = self.players.get(data.get("target"))
        if not target or not target.alive or not shooter.alive:
            return
        if target.team == shooter.team or self.phase == "freeze":
            return  # без огня по своим и во время заморозки
        is_head = bool(data.get("head"))
        melee = data.get("melee")
        if melee in KNIFE_DMG:
            # удар ножом засчитываем только вблизи
            if abs(target.pos[0] - shooter.pos[0]) + abs(target.pos[2] - shooter.pos[2]) > MELEE_RANGE * 1.4:
                return
            weapon, wallbang, dmg = "knife", False, KNIFE_DMG[melee]
        elif self.rules["headshot"] and not is_head:
            return  # правило «только в голову»: по телу урона нет
        else:
            # из какого оружия выстрел: клиент сообщает, сервер проверяет, что оно у игрока есть
            weapon = data.get("weapon") if data.get("weapon") in GUNS else shooter.weapon
            if weapon not in GUNS or not shooter.owns(weapon):
                weapon = shooter.secondary
            body, head = WEAPONS[weapon]
            wallbang = bool(data.get("wallbang"))
            dmg = head if is_head else body
        if wallbang:
            # клиент сообщает, какая доля урона осталась после прострела (зависит от толщины)
            pen = data.get("pen")
            mult = float(pen) if isinstance(pen, (int, float)) else WALLBANG_MUL
            dmg = max(1, round(dmg * min(max(mult, 0.25), 1.0)))
        # сквозь дым: линия от глаз стрелка до места попадания проходит через облако
        smoke = False
        if weapon != "knife" and self.smokes:
            eye = [shooter.pos[0], shooter.pos[1] + (1.15 if shooter.crouch else 1.6), shooter.pos[2]]
            spot = [target.pos[0], target.pos[1] + (1.5 if is_head else 1.0), target.pos[2]]
            smoke = self.smoke_blocks(eye, spot)
        await self.apply_damage(target, shooter, dmg, weapon, is_head,
                                wallbang=wallbang, jump=bool(data.get("jump")),
                                noscope=bool(data.get("noscope")) and weapon == "awp",
                                smoke=smoke, blind=time.time() < shooter.blind_until)

    async def apply_damage(self, target, attacker, dmg, weapon, head=False, wallbang=False, jump=False, noscope=False,
                           smoke=False, blind=False):
        """Урон с учётом брони; при убийстве — килфид и награда убийце."""
        if head and target.armor >= 2:
            dmg *= ARMOR_HEAD.get(weapon, 1.0)
        elif not head and target.armor >= 1:
            dmg *= ARMOR_BODY.get(weapon, 1.0)
        dmg = max(1, round(dmg))
        dealt = min(dmg, target.hp)
        target.hp = max(0, target.hp - dmg)
        target.dmg_from[attacker.id] = target.dmg_from.get(attacker.id, 0) + dealt  # для помощи в убийстве
        if target.brain:
            target.brain.alert(attacker.pos, time.time())
        await self.send(target, {"type": "damaged", "hp": target.hp, "from": attacker.pos})
        await self.send(attacker, {"type": "hitConfirm", "head": head, "kill": target.hp == 0})
        if target.hp == 0:
            self.drop_on_death(target)
            self.kill_off(target)
            target.deaths += 1
            attacker.kills += 1
            attacker.round_kills += 1
            assist = self.find_assist(target, attacker)
            social.record(target.pid, deaths=1)
            if attacker.team != target.team:
                attacker.headshots += int(head)
                # счётчики для достижений
                enemy = self.team_size.get(target.team, 0)
                ace = int(enemy >= 3 and attacker.round_kills == enemy)   # один убил всю команду врага за раунд
                social.record(attacker.pid, kills=1, headshots=int(head), knife_kills=int(weapon == "knife"),
                              awp_kills=int(weapon == "awp"), wallbangs=int(wallbang), jump_kills=int(jump), aces=ace,
                              noscopes=int(noscope), smoke_kills=int(smoke), blind_kills=int(blind))
                self.award(attacker, 25 if head else 20, "хедшот" if head else "убийство")
                if attacker.pid and not attacker.brain:   # золото и задания дня — считает сервер
                    social.game_gold(attacker.pid, GOLD["kill"], "убийство")
                    social.game_mission(attacker.pid, "kill", f"kill:{weapon}", head and "head",
                                        jump and "jump", wallbang and "wallbang", smoke and "smoke")
                helper = assist and self.players.get(assist["id"])
                if helper:
                    self.award(helper, 10, "помощь")
                    if helper.pid and not helper.brain:
                        social.game_gold(helper.pid, GOLD["assist"], "помощь")
            await self.give_money(attacker, KILL_REWARD.get(weapon, 300), "за убийство")
            await self.broadcast({
                "type": "kill", "killer": attacker.name, "killerId": attacker.id,
                "killerTeam": attacker.team, "victim": target.name,
                "victimTeam": target.team, "victimId": target.id,
                "head": head, "wallbang": wallbang, "jump": jump, "noscope": noscope,
                "smoke": smoke, "blind": blind, "weapon": weapon, "knife": attacker.knife, "respawn": self.phase == "warmup",
                "assist": assist, "cheats": attacker.cheats,
            })

    def award(self, p, amount, reason):
        """Опыт игроку: в профиль и в итоги матча."""
        if p and not p.brain:
            p.match_xp += amount
            social.give_xp(p.pid, amount, reason)

    def find_assist(self, victim, killer):
        """Помощь в убийстве: союзник убийцы, который нанёс жертве 40+ урона
        или ослепил её флешкой незадолго до смерти."""
        best, best_dmg = None, ASSIST_DAMAGE - 1
        for pid, dmg in victim.dmg_from.items():
            p = self.players.get(pid)
            if p and p is not killer and p.team == killer.team and dmg > best_dmg:
                best, best_dmg = p, dmg
        flash = False
        if not best and victim.flashed_by:
            pid, until = victim.flashed_by
            p = self.players.get(pid)
            if p and p is not killer and p.team == killer.team and time.time() < until:
                best, flash = p, True
        if not best:
            return None
        best.assists += 1
        return {"id": best.id, "name": best.name, "team": best.team, "flash": flash}

    # ---------- гранаты ----------
    async def throw(self, p, data):
        kind = data.get("kind")
        pos, vel = data.get("pos"), data.get("vel")
        if kind not in NADES or not p.alive or p.nades.get(kind, 0) < 1 or self.phase == "freeze":
            return
        if not (isinstance(pos, list) and isinstance(vel, list) and len(pos) == 3 and len(vel) == 3):
            return
        pos, vel = [float(v) for v in pos], [float(v) for v in vel]
        # бросок должен начинаться у самого игрока и быть не быстрее разумного
        if dist2d(pos, p.pos) > 2.0 or sum(v * v for v in vel) > 30 ** 2:
            return
        p.nades[kind] -= 1
        if p.weapon == kind:
            p.weapon = p.primary or p.secondary
        self.nades.append(Nade(kind, p.id, pos, vel, time.time()))
        await self.send(p, {"type": "inventory", **p.inventory()})
        await self.broadcast({"type": "throw", "id": p.id, "kind": kind})

    # ---------- оружие на земле ----------
    MAX_GUNS = 16
    PICKUP_DIST = 1.2

    def drop_gun(self, p, item, pos, vel, ammo=None):
        """Убрать оружие из рук игрока и бросить его в мир."""
        slot = slot_of(item)
        if getattr(p, slot) != item:
            return False
        setattr(p, slot, None)
        if p.weapon == item:
            p.weapon = p.primary or p.secondary or "knife"
        gun = DroppedGun(item, p.id, pos, vel, p.yaw, time.time(), ammo, p.skins.get(item))
        if gun.inside(self.world):  # стоял вплотную к стене — пусть падает у ног, а не застревает в ней
            gun.pos = [p.pos[0], p.pos[1] + 1.0, p.pos[2]]
        self.guns.append(gun)
        if len(self.guns) > self.MAX_GUNS:
            self.guns.pop(0)   # самое старое исчезает
        return True

    async def drop(self, p, data):
        """G: выбросить оружие из рук. Клиент присылает откуда и с какой скоростью оно полетит."""
        item = p.weapon
        pos, vel = data.get("pos"), data.get("vel")
        if not p.alive or item not in GUNS or not p.owns(item):
            return
        if not (isinstance(pos, list) and isinstance(vel, list) and len(pos) == 3 and len(vel) == 3):
            return
        try:
            pos, vel = [float(v) for v in pos], [float(v) for v in vel]
        except (TypeError, ValueError):
            return
        if dist2d(pos, p.pos) > 2.0 or sum(v * v for v in vel) > 15 ** 2:
            return
        ammo = data.get("ammo") if isinstance(data.get("ammo"), dict) else None
        if self.drop_gun(p, item, pos, vel, ammo):
            await self.send(p, {"type": "inventory", **p.inventory()})
            await self.broadcast({"type": "gunDrop", "id": p.id, "pos": pos})

    async def pickup(self, p, data):
        """E: взять конкретный ствол с земли; если слот занят — своё оружие падает на его место (обмен)."""
        gun = next((g for g in self.guns if g.id == data.get("id")), None)
        if not gun or not p.alive or dist2d(gun.pos, p.pos) > 2.2 or abs(gun.pos[1] - p.pos[1]) > 2.0:
            return
        slot = slot_of(gun.item)
        old = getattr(p, slot)
        self.guns.remove(gun)
        if old:
            setattr(p, slot, None)
            ammo = data.get("ammo") if isinstance(data.get("ammo"), dict) else None
            # своё — под ноги, чуть вперёд; поднять обратно можно сразу же
            a = p.yaw
            dropped = DroppedGun(old, None, [p.pos[0], p.pos[1] + 0.8, p.pos[2]],
                                 [-math.sin(a) * 1.5, 1.0, -math.cos(a) * 1.5], p.yaw, time.time(), ammo, p.skins.get(old))
            self.guns.append(dropped)
        setattr(p, slot, gun.item)
        p.weapon = gun.item
        await self.send(p, {"type": "inventory", **p.inventory(), "picked": gun.item, "ammo": gun.ammo, "skin": gun.skin})
        await self.broadcast({"type": "gunDrop", "id": p.id, "pos": p.pos})

    def drop_on_death(self, p):
        """Убитый роняет лучшее оружие — его можно подобрать."""
        item = p.primary or p.secondary
        if not item:
            return
        a = p.yaw
        vel = [-math.sin(a) * 1.5 + random.uniform(-0.5, 0.5), 2.0, -math.cos(a) * 1.5 + random.uniform(-0.5, 0.5)]
        self.drop_gun(p, item, [p.pos[0], p.pos[1] + 1.0, p.pos[2]], vel)

    async def update_guns(self, now, dt):
        for g in self.guns:
            g.step(self.world, dt)
        # подбор: проходишь рядом — берёшь, если этот слот пуст (свой выброшенный — не раньше чем через секунду)
        for p in list(self.players.values()):
            if not p.alive:
                continue
            for g in list(self.guns):
                if g.owner == p.id and now - g.born < 1.0:
                    continue
                if dist2d(g.pos, p.pos) > self.PICKUP_DIST or abs(g.pos[1] - p.pos[1]) > 1.8:
                    continue
                slot = slot_of(g.item)
                if getattr(p, slot):
                    continue
                setattr(p, slot, g.item)
                self.guns.remove(g)
                if p.brain:
                    p.weapon = p.primary or p.secondary
                else:
                    await self.send(p, {"type": "inventory", **p.inventory(), "picked": g.item, "ammo": g.ammo, "skin": g.skin})

    def smoke_blocks(self, a, b):
        """Дым закрывает обзор между точками a и b."""
        return any(segment_hits_sphere(a, b, s["pos"], SMOKE_RADIUS) for s in self.smokes)

    async def update_nades(self, now, dt):
        self.smokes = [s for s in self.smokes if s["until"] > now]
        for n in list(self.nades):
            n.step(self.world, dt)
            if now >= n.explode_at:
                self.nades.remove(n)
                await self.detonate(n, now)

    async def detonate(self, n, now):
        pos = n.pos
        await self.broadcast({"type": "detonate", "kind": n.kind, "pos": pos, "id": n.id})
        owner = self.players.get(n.owner)
        if n.kind == "smoke":
            self.smokes.append({"pos": [pos[0], max(pos[1], 1.2), pos[2]], "until": now + SMOKE_TIME})
            return
        for p in list(self.players.values()):
            if not p.alive:
                continue
            eye = [p.pos[0], p.pos[1] + (1.15 if p.crouch else 1.6), p.pos[2]]
            d = sum((eye[i] - pos[i]) ** 2 for i in range(3)) ** 0.5
            src = [pos[0], pos[1] + 0.2, pos[2]]
            if n.kind == "he":
                # осколочная: урон рядом, если между гранатой и игроком нет стены; по своим не бьёт
                if d >= HE_RADIUS or not owner or (p.team == owner.team and p is not owner) or p is owner:
                    continue
                chest = [p.pos[0], p.pos[1] + 1.0, p.pos[2]]
                if self.world.los(src, chest):
                    await self.apply_damage(p, owner, he_damage(d), "he")
            elif n.kind == "flash":
                # флешка: ослепляет всех, кто её видит; сильнее всего — если смотрит прямо на неё
                if d >= FLASH_RANGE or not self.world.los(src, eye) or self.smoke_blocks(src, eye):
                    continue
                cp = math.cos(p.pitch)
                look = (-math.sin(p.yaw) * cp, math.sin(p.pitch), -math.cos(p.yaw) * cp)
                dot = sum(look[i] * (pos[i] - eye[i]) for i in range(3)) / max(d, 0.01)
                duration = (3.5 if dot > 0.5 else 1.6 if dot > -0.3 else 0.5) * max(0.3, 1 - d / FLASH_RANGE)
                if owner and p.team != owner.team and duration > 0.6:
                    p.flashed_by = (owner.id, now + duration + 1.0)  # для «помощи флешкой»
                if duration > 0.6:
                    p.blind_until = max(p.blind_until, now + duration * 0.8)  # почти ничего не видит
                if p.brain:
                    p.brain.blind_until = now + duration
                else:
                    await self.send(p, {"type": "flashed", "duration": round(duration, 2)})

    # ---------- экономика ----------
    async def give_money(self, p, amount, reason):
        if amount <= 0:
            return
        p.money = min(MAX_MONEY, p.money + amount)
        await self.send(p, {"type": "inventory", **p.inventory(), "delta": amount, "reason": reason})

    def buy_open(self):
        """Покупать можно в разминке, в заморозке и первые BUY_TIME секунд раунда."""
        if self.phase in ("warmup", "freeze"):
            return True
        return self.phase == "live" and time.time() < self.live_since + BUY_TIME

    async def buy(self, p, item):
        if item not in SHOP or not p.alive or not self.buy_open() or self.rules["weapons"] != "buy":
            return
        price, kind = SHOP[item]
        if kind == "nade" and not self.rules["nades"]:
            return
        if self.phase == "warmup":
            price = 0   # в разминке всё бесплатно — можно попробовать любое оружие
        if kind == "armor":
            if p.armor >= (2 if item == "helmet" else 1):
                return
            if item == "helmet" and p.armor == 1:
                price = min(price, 350)   # жилет уже есть — докупаем только шлем
        elif kind == "nade":
            if p.nades[item] >= 1:
                return
        elif getattr(p, kind) == item:
            return
        # купил не то: прежний ствол из этого раунда сдаётся за полную цену (обмен)
        refund = 0
        old = getattr(p, kind) if kind in ("primary", "secondary") else None
        if old and old in p.bought:
            refund = p.bought[old][0]
        if p.money + refund < price:
            return
        prev = old
        if old and old in p.bought:
            prev = p.bought.pop(old)[1]   # то, что было до неудачной покупки
        elif old and old != "pistol":
            # своё старое (с прошлого раунда) не пропадает — падает под ноги, как в CS
            a = p.yaw
            self.guns.append(DroppedGun(old, p.id, [p.pos[0], p.pos[1] + 0.8, p.pos[2]],
                                        [-math.sin(a) * 1.5, 1.0, -math.cos(a) * 1.5], p.yaw, time.time(),
                                        None, p.skins.get(old)))
        p.money += refund - price
        if kind == "armor":
            p.bought[item] = (price, p.armor)
            p.armor = 2 if item == "helmet" else 1
        elif kind == "nade":
            p.bought[item] = (price, 0)
            p.nades[item] = 1
        else:
            p.bought[item] = (price, prev)
            setattr(p, kind, item)
            p.weapon = item
        await self.send(p, {"type": "inventory", **p.inventory(), "bought": item})

    async def sell(self, p, item):
        """Продать купленное в этом раунде (пока открыта закупка) — деньги возвращаются полностью."""
        if not p.alive or not self.buy_open() or item not in p.sellable():
            return
        price, prev = p.bought.pop(item)
        kind = SHOP[item][1]
        if kind == "armor":
            p.armor = prev
        elif kind == "nade":
            p.nades[item] = 0
        else:
            setattr(p, kind, prev)
            if p.weapon == item:
                p.weapon = p.primary or p.secondary or "knife"
        p.money = min(MAX_MONEY, p.money + price)
        await self.send(p, {"type": "inventory", **p.inventory(), "sold": item})

    async def round_rewards(self, winner, reason):
        """Деньги за раунд: победителям больше, проигравшим — растущий бонус за серию поражений."""
        planted = bool(self.bomb) and self.bomb.get("planter_id") is not None
        for team in TEAMS:
            if team == winner:
                self.loss_streak[team] = 0
            else:
                self.loss_streak[team] = min(self.loss_streak[team] + 1, len(LOSS_REWARD))
        for p in self.players.values():
            if p.team == winner:
                await self.give_money(p, WIN_REWARD.get(reason, 3250), "победа в раунде")
            elif winner:
                bonus = LOSS_REWARD[self.loss_streak[p.team] - 1]
                if p.team == "t" and planted:
                    bonus += PLANT_BONUS
                await self.give_money(p, bonus, "проигрыш раунда")

    def bot_buy(self, p):
        """Боты закупаются сами: при деньгах — автомат (иногда AWP; спецназ чаще берёт M4) и броня,
        на половину денег — MP5 или дробовик, иначе Desert Eagle."""
        if p.primary is None:
            if p.money >= 4750 + 1000 and random.random() < 0.2:
                p.primary, p.money = "awp", p.money - 4750
            elif p.team == "ct" and p.money >= 3100 and random.random() < 0.6:
                p.primary, p.money = "m4", p.money - 3100
            elif p.money >= 2700:
                p.primary, p.money = "rifle", p.money - 2700
            elif p.money >= 2200 and random.random() < 0.5:
                gun = random.choice(("smg", "shotgun"))
                p.primary, p.money = gun, p.money - SHOP[gun][0]
        if p.armor == 0 and p.money >= 1000:
            p.armor, p.money = 2, p.money - 1000
        elif p.armor == 0 and p.money >= 650:
            p.armor, p.money = 1, p.money - 650
        if p.primary is None and p.secondary == "pistol" and p.money >= 700:
            p.secondary, p.money = "deagle", p.money - 700
        p.weapon = p.primary or p.secondary

    def noise(self, shooter: Player):
        """Боты другой команды слышат выстрел поблизости."""
        now = time.time()
        for p in self.players.values():
            if p.brain and p.alive and p.team != shooter.team and p.brain.target is None:
                if abs(p.pos[0] - shooter.pos[0]) + abs(p.pos[2] - shooter.pos[2]) < HEAR_DIST:
                    p.brain.alert(shooter.pos, now, 3.0)

    # ---------- бомба ----------
    def site_at(self, pos):
        """На какой точке закладки стоит игрок (или None)."""
        for name, (x, z, r) in self.sites.items():
            if dist2d(pos, (x, z)) <= r:
                return name
        return None

    def give_bomb(self):
        """В начале раунда бомба достаётся случайному террористу."""
        self.bomb = None
        self.bomb_phys = None
        self.bomb_action = None
        ts = [p for p in self.players.values() if p.team == "t" and p.alive]
        if self.mode != "bomb" or not ts:
            return
        carrier = random.choice(ts)
        self.bomb = {"state": "carried", "carrier": carrier.id, "pos": list(carrier.pos), "site": None,
                     "explode_at": 0.0, "planter": "", "planter_id": None, "target": random.choice(list(self.sites))}

    def drop_bomb(self, p):
        """Носитель погиб или вышел — бомба падает там, где он стоял."""
        b = self.bomb
        if b and b["state"] == "carried" and b["carrier"] == p.id:
            b.update(state="dropped", carrier=None, pos=[p.pos[0], p.pos[1], p.pos[2]])
            self.bomb_phys = None

    async def throw_bomb(self, p, data):
        """G с бомбой в руках: бросить её (например, союзнику). Летит и падает как выброшенное оружие."""
        b = self.bomb
        if not (b and b["state"] == "carried" and b["carrier"] == p.id and p.alive):
            return
        pos, vel = data.get("pos"), data.get("vel")
        if not (isinstance(pos, list) and isinstance(vel, list) and len(pos) == 3 and len(vel) == 3):
            return
        try:
            pos, vel = [float(v) for v in pos], [float(v) for v in vel]
        except (TypeError, ValueError):
            return
        if dist2d(pos, p.pos) > 2.0 or sum(v * v for v in vel) > 15 ** 2:
            return
        now = time.time()
        phys = DroppedGun("c4", p.id, pos, vel, p.yaw, now)
        if phys.inside(self.world):
            phys.pos = [p.pos[0], p.pos[1] + 1.0, p.pos[2]]
        self.bomb_phys = phys
        p.using = False
        b.update(state="dropped", carrier=None, pos=list(phys.pos), dropped_by=p.id, dropped_at=now)
        for q in self.humans():   # видят только свои — спецназу знать не положено
            if q.team == "t":
                await self.send(q, {"type": "chat", "text": f"💣 {p.name} выбросил бомбу"})

    def set_using(self, p, active):
        """E нажата/отпущена: запоминаем, когда и где начали держать."""
        if active and not p.using:
            p.use_start = time.time()
            p.use_pos = list(p.pos)
        p.using = bool(active) and p.alive

    def use_progress(self, p, now, allowed):
        """Сколько секунд игрок держит E на месте; сдвинулся или нельзя — отсчёт сначала."""
        if not p.using or not allowed or dist2d(p.pos, p.use_pos) > 0.6:
            p.use_start = now
            p.use_pos = list(p.pos)
            return 0.0
        return now - p.use_start

    async def update_bomb(self, now):
        b = self.bomb
        self.bomb_action = None
        if b["state"] == "dropped":
            phys = self.bomb_phys
            if phys:   # брошенная бомба летит и падает
                dt = min(0.1, max(0.0, now - getattr(self, "_bomb_t", now)))
                phys.step(self.world, dt)
                b["pos"] = list(phys.pos)
            self._bomb_t = now
            for p in self.players.values():
                if not (p.alive and p.team == "t" and dist2d(p.pos, b["pos"]) < PICKUP_RANGE):
                    continue
                if abs(b["pos"][1] - p.pos[1]) > 1.8:
                    continue   # бомба на ящике или ещё в воздухе
                if p.id == b.get("dropped_by") and now - b.get("dropped_at", 0) < 1.5:
                    continue   # только что выбросил сам — не подбирает обратно сразу же
                b.update(state="carried", carrier=p.id, dropped_by=None)
                self.bomb_phys = None
                if not p.brain:
                    await self.send(p, {"type": "chat", "text": "💣 Ты подобрал бомбу"})
                break
        if b["state"] == "carried":
            carrier = self.players.get(b["carrier"])
            if not carrier or not carrier.alive:
                b.update(state="dropped", carrier=None)
                return
            b["pos"] = list(carrier.pos)
            site = self.site_at(carrier.pos)
            held = self.use_progress(carrier, now, site is not None)
            if carrier.using and site:
                self.bomb_action = {"id": carrier.id, "kind": "plant", "frac": min(1.0, held / PLANT_TIME)}
            if held >= PLANT_TIME:
                carrier.using = False
                b.update(state="planted", carrier=None, pos=list(carrier.pos), site=site,
                         explode_at=now + BOMB_TIME, planter=carrier.name, planter_id=carrier.id)
                await self.broadcast({"type": "bombPlanted", "site": site, "by": carrier.name, "pos": b["pos"]})
                social.record(carrier.pid, plants=1)
        elif b["state"] == "planted":
            for p in self.players.values():
                if not (p.alive and p.team == "ct" and p.using):
                    continue
                held = self.use_progress(p, now, dist2d(p.pos, b["pos"]) <= DEFUSE_RANGE)
                if dist2d(p.pos, b["pos"]) <= DEFUSE_RANGE:
                    self.bomb_action = {"id": p.id, "kind": "defuse", "frac": min(1.0, held / DEFUSE_TIME)}
                if held >= DEFUSE_TIME:
                    b["state"] = "defused"
                    await self.broadcast({"type": "bombDefused", "by": p.name})
                    social.record(p.pid, defuses=1)
                    await self.end_round("ct", "defuse", mvp=p)  # MVP — тот, кто разминировал
                    return
            if now >= b["explode_at"]:
                await self.explode()

    async def explode(self):
        b = self.bomb
        b["state"] = "exploded"
        await self.broadcast({"type": "explode", "pos": b["pos"]})
        for p in list(self.players.values()):
            d = ((p.pos[0] - b["pos"][0]) ** 2 + (p.pos[1] - b["pos"][1]) ** 2 + (p.pos[2] - b["pos"][2]) ** 2) ** 0.5
            if not p.alive or d >= BLAST_RADIUS:
                continue
            p.hp = max(0, p.hp - round(BLAST_DAMAGE * (1 - d / BLAST_RADIUS)))
            await self.send(p, {"type": "damaged", "hp": p.hp, "from": b["pos"]})
            if p.hp == 0:
                self.drop_on_death(p)
                self.kill_off(p)
                p.deaths += 1
                await self.broadcast({
                    "type": "kill", "killer": b["planter"] or "Бомба", "killerId": None, "killerTeam": "t",
                    "victim": p.name, "victimTeam": p.team, "victimId": p.id, "weapon": "bomb",
                    "head": False, "wallbang": False, "jump": False, "respawn": False,
                })
        await self.end_round("t", "bomb", mvp=self.players.get(b["planter_id"]))  # MVP — тот, кто заложил

    def bomb_public(self):
        b = self.bomb
        if not b:
            return None
        return {"state": b["state"], "carrier": b["carrier"], "pos": b["pos"], "site": b["site"],
                "timeLeft": max(0.0, b["explode_at"] - time.time()) if b["state"] == "planted" else None,
                "action": self.bomb_action}

    def objective_for(self, p):
        """Задача для бота в режиме бомбы: (куда идти, действие, можно ли действовать сейчас)."""
        b = self.bomb
        if not b or self.phase != "live" or b["state"] in ("defused", "exploded"):
            return None
        if p.team == "t":
            if b["state"] == "carried" and b["carrier"] == p.id:
                x, z, r = self.sites[b["target"]]
                return (x, z), "plant", self.site_at(p.pos) == b["target"] and dist2d(p.pos, (x, z)) < r - 1.5
            if b["state"] == "dropped":
                return (b["pos"][0], b["pos"][2]), None, False
            # остальные (и тот, кто заложил) прикрывают точку или саму бомбу, каждый — со своей стороны.
            # Раз в ~9 секунд место меняется — боты переходят от укрытия к укрытию, а не стоят столбом
            x, z, _ = self.sites[b["site"] or b["target"]]
            if b["state"] == "planted":
                x, z = b["pos"][0], b["pos"][2]
            slot = int(time.time() / 9)
            angle = p.id * 2.4 + slot * 1.7
            r = 4 + (p.id + slot) % 3
            gx, gz = x + r * math.cos(angle), z + r * math.sin(angle)
            cell = self.world.nearest_free(gx, gz)   # точка в стене или ящике — ближайшая свободная рядом
            if cell:
                gx, gz = self.world.cell_pos(*cell)
            return (gx, gz), "guard", False, (x, z)
        if b["state"] == "planted":
            return (b["pos"][0], b["pos"][2]), "defuse", dist2d(p.pos, b["pos"]) < DEFUSE_RANGE - 0.5
        return None

    # ---------- боты ----------
    async def add_bot(self, team):
        used = {p.name for p in self.players.values()}
        free = [n for n in BOT_NAMES if f"BOT {n}" not in used] or [str(self.next_id)]
        bot = Player(self.next_id, f"BOT {random.choice(free)}", team, None, BotBrain())
        self.next_id += 1
        self.spawn(bot)
        if self.phase in ("live", "end"):
            self.kill_off(bot)  # посреди раунда — ждёт следующего
        self.players[bot.id] = bot

    async def remove_bot(self, bot):
        self.players.pop(bot.id, None)
        await self.broadcast({"type": "leave", "id": bot.id})

    async def rebalance_bots(self):
        """Боты добивают каждую команду до bot_fill игроков (когда на сервере есть люди)."""
        has_humans = bool(self.humans())
        for team in TEAMS:
            want = max(0, self.bot_fill - len(self.humans(team))) if has_humans else 0
            bots = [p for p in self.players.values() if p.brain and p.team == team]
            bots.sort(key=lambda b: b.alive)  # сначала убираем мёртвых
            while len(bots) > want:
                await self.remove_bot(bots.pop(0))
            for _ in range(want - len(bots)):
                await self.add_bot(team)

    async def command(self, player: Player, text):
        parts = text.split()
        cmd = parts[0].lower()
        if cmd == "/bots" and len(parts) > 1 and parts[1].isdigit():
            self.bot_fill = min(int(parts[1]), MAX_TEAM)
            await self.rebalance_bots()
            msg = f"Боты выключены" if self.bot_fill == 0 else f"Команды добиваются ботами до {self.bot_fill} на {self.bot_fill}"
            await self.broadcast({"type": "chat", "text": f"{player.name}: {msg}"})
        elif cmd == "/map" and len(parts) > 1 and parts[1].lower() in MAPS:
            await self.broadcast({"type": "chat", "text": f"{player.name}: карта — {MAPS[parts[1].lower()]['name']}, новый матч"})
            await self.change_map(parts[1].lower())
        elif cmd == "/mode" and len(parts) > 1 and parts[1].lower() in MODES:
            self.mode = parts[1].lower()
            name = "закладка бомбы" if self.mode == "bomb" else "командный бой"
            await self.broadcast({"type": "chat", "text": f"{player.name}: режим — {name} (со следующего раунда)"})
        elif cmd == "/diff" and len(parts) > 1 and parts[1].lower() in DIFFICULTY:
            self.difficulty = parts[1].lower()
            await self.broadcast({"type": "chat", "text": f"{player.name}: сложность ботов — {DIFFICULTY_NAME[self.difficulty]}"})
        else:
            await self.send(player, {"type": "chat", "text":
                f"Команды: /bots 0-{MAX_TEAM} (сейчас {self.bot_fill}), "
                f"/diff easy|normal|hard|expert (сейчас {self.difficulty}), /mode bomb|tdm (сейчас {self.mode}), /map {'|'.join(MAPS)} (сейчас {self.map_id})"})

    # ---------- раунды ----------
    def set_phase(self, phase, duration):
        self.phase = phase
        self.phase_end = time.time() + duration

    async def start_round(self):
        new_match = self.round == 0
        self.round += 1
        self.set_phase("freeze", FREEZE_TIME)
        self.nades.clear()
        self.smokes.clear()
        if new_match:
            self.loss_streak = {"ct": 0, "t": 0}
        self.guns.clear()  # каждый раунд земля чистая — старое оружие не копится
        for p in self.players.values():
            p.using = False
            p.round_kills = 0
            p.bought = {}   # продать можно только купленное в этом раунде
            if new_match:
                p.money = START_MONEY
                p.reset_loadout()
            elif not p.alive:
                p.reset_loadout()  # погиб в прошлом раунде — оружие потеряно
            self.apply_loadout_rules(p)
            await self.respawn(p)
            if p.brain:
                self.bot_buy(p)
            else:
                p.weapon = p.primary or p.secondary
                await self.send(p, {"type": "inventory", **p.inventory()})
        self.give_bomb()
        self.team_size = {t: self.count(t) for t in TEAMS}
        if new_match:
            for p in self.players.values():
                p.headshots = p.match_xp = 0
        await self.broadcast({"type": "roundStart", "round": self.round, "mode": self.mode, "buyTime": BUY_TIME})

    def apply_loadout_rules(self, p):
        """Правила лобби: бесконечные деньги или у всех одно и то же оружие."""
        if self.rules["money"] == "unlimited":
            p.money = MAX_MONEY
        w = self.rules["weapons"]
        if w == "buy":
            return
        p.primary = w if w in PRIMARY else None
        p.secondary = w if w in ("pistol", "deagle") else None
        p.armor = 0 if w == "knife" else 2
        p.nades = {n: 0 for n in NADES}
        p.weapon = p.primary or p.secondary or "knife"

    def match_summary(self, elo):
        """Итоги матча для экрана в конце: счёт, все игроки и их статистика, MVP матча, рейтинг 1 на 1."""
        players = [{
            "id": p.id, "name": p.name, "team": p.team, "bot": p.brain is not None,
            "kills": p.kills, "deaths": p.deaths, "assists": p.assists, "mvps": p.mvps,
            "hs": round(100 * p.headshots / p.kills) if p.kills else 0, "xp": p.match_xp,
            "elo": elo.get(p.pid), "rank": rank_of(social.profiles[p.pid]["stats"]["elo"]) if p.pid in elo else None,
        } for p in self.players.values()]
        best = max(self.players.values(), key=lambda p: (p.mvps, p.kills, -p.deaths), default=None)
        return {"score": dict(self.score), "players": players, "mvp": best.id if best else None}

    def pick_mvp(self, winner):
        """MVP раунда — игрок победившей команды с наибольшим числом убийств за раунд."""
        team = [p for p in self.players.values() if p.team == winner and p.round_kills > 0]
        return max(team, key=lambda p: (p.round_kills, p.alive), default=None)

    async def end_round(self, winner, reason, mvp=None):
        if winner:
            self.score[winner] += 1
        await self.round_rewards(winner, reason)
        # за бомбу MVP — сапёр или тот, кто заложил; иначе — лучший по убийствам
        if winner and not mvp:
            mvp = self.pick_mvp(winner)
            why = "kills"
        else:
            why = reason
        mvp_info = None
        if mvp:
            mvp.mvps += 1
            mvp_info = {"id": mvp.id, "name": mvp.name, "team": mvp.team, "why": why, "kills": mvp.round_kills}
        for p in self.humans(winner) if winner else []:
            self.award(p, 15, "победа в раунде")
            if p.pid:
                social.game_gold(p.pid, GOLD["round"], "победа в раунде")
                social.game_mission(p.pid, "round")
        if mvp:
            self.award(mvp, 25, "MVP")
            social.record(mvp.pid, mvps=1)
            if mvp.pid and not mvp.brain:
                social.game_gold(mvp.pid, GOLD["mvp"], "MVP")
                social.game_mission(mvp.pid, "mvp")
        match_over = winner is not None and self.score[winner] >= self.rules["rounds"]
        await self.broadcast({"type": "roundEnd", "winner": winner, "reason": reason, "score": self.score, "mvp": mvp_info})
        if match_over:
            for p in self.humans():
                social.record(p.pid, matches=1, wins=int(p.team == winner))
                self.award(p, 100 if p.team == winner else 30, "победа в матче" if p.team == winner else "матч сыгран")
                if p.pid and p.team == winner:
                    social.game_gold(p.pid, GOLD["match"], "победа в матче")
            # лобби 1 на 1 — рейтинг
            elo = {}
            duelists = [p for p in self.humans() if p.pid]
            if self.lobby and len(duelists) == 2:
                win = next((p for p in duelists if p.team == winner), None)
                lose = next((p for p in duelists if p.team != winner), None)
                if win and lose:
                    elo = social.duel_result(win.pid, lose.pid)
            await self.broadcast({"type": "matchEnd", "winner": winner, "summary": self.match_summary(elo)})
            self.score = {"ct": 0, "t": 0}
            self.round = 0
            for p in self.players.values():
                p.kills = p.deaths = p.mvps = p.assists = 0
            self.set_phase("end", MATCH_END_TIME)
        else:
            self.set_phase("end", ROUND_END_TIME)

    async def update_rounds(self):
        now = time.time()
        if self.phase == "warmup":
            for p in list(self.players.values()):
                if not p.alive and now >= p.respawn_at:
                    await self.respawn(p)
            if self.teams_ready():
                self.score = {"ct": 0, "t": 0}
                self.round = 0
                await self.broadcast({"type": "chat", "text": "Обе команды в сборе — матч начинается!"})
                await self.start_round()
            return

        if not self.teams_ready():
            self.set_phase("warmup", 0)
            self.bomb = None
            await self.broadcast({"type": "chat", "text": "Ждём игроков в обеих командах — разминка"})
            for p in self.players.values():
                if not p.alive:
                    p.respawn_at = now + 1
            return

        if self.phase == "freeze" and now >= self.phase_end:
            self.set_phase("live", ROUND_TIME)
            self.live_since = now
        elif self.phase == "live":
            if self.bomb:
                await self.update_bomb(now)  # закладка, разминирование, взрыв
                if self.phase != "live":
                    return
            planted = bool(self.bomb) and self.bomb["state"] == "planted"
            ct, t = self.count("ct", True), self.count("t", True)
            if ct == 0:
                # все CT убиты — победа T (если и T никого, то ничья, пока бомба не заложена)
                await self.end_round("t" if t > 0 or planted else None, "elimination")
            elif t == 0 and not planted:
                await self.end_round("ct", "elimination")  # после закладки CT ещё должны разминировать
            elif now >= self.phase_end and not planted:
                if self.mode == "bomb":
                    await self.end_round("ct", "time")  # не успели заложить — победа CT
                else:
                    await self.end_round("ct" if ct > t else "t" if t > ct else None, "time")
        elif self.phase == "end" and now >= self.phase_end:
            await self.start_round()

    async def tick_loop(self):
        while True:
            try:
                await self.update_rounds()
                now = time.time()
                await self.update_nades(now, 1 / TICK_RATE)
                await self.update_guns(now, 1 / TICK_RATE)
                for p in list(self.players.values()):
                    if p.brain:
                        await p.brain.update(p, self, now, 1 / TICK_RATE)
            except Exception as e:  # ошибка в одном тике не должна ронять сервер
                print("Ошибка в тике:", repr(e))
            if self.players:
                await self.broadcast({
                    "type": "snapshot",
                    "players": [p.public() for p in self.players.values()],
                    "score": self.score,
                    "phase": self.phase,
                    "timeLeft": max(0, self.phase_end - time.time()),
                    "round": self.round,
                    "mode": self.mode,
                    "bomb": self.bomb_public(),
                    "buyLeft": max(0.0, self.live_since + BUY_TIME - time.time()) if self.phase == "live"
                               else (999 if self.buy_open() else 0),
                    "nades": [n.public() for n in self.nades],
                    "guns": [g.public() for g in self.guns],
                    "smokes": [{"pos": s["pos"], "left": s["until"] - time.time()} for s in self.smokes],
                })
            await asyncio.sleep(1 / TICK_RATE)


# Игры (комнаты): "public" — общая онлайн-игра, "solo-…" — личная игра с ботами
games: dict[str, Game] = {}


def get_game(room):
    g = games.get(room)
    if g is None:
        g = Game()
        g.room = room
        g.task = asyncio.create_task(g.tick_loop())
        games[room] = g
    return g


async def close_if_empty(g):
    if g.room != "public" and not g.humans():
        g.task.cancel()
        games.pop(g.room, None)
        if g.lobby:
            await social.lobby_game_over(g.lobby)


def start_lobby_game(code, settings, teams):
    """Игра лобби (от 1 на 1 до 5 на 5): отдельная комната с правилами из настроек лобби.
    Боты — только если хозяин их включил: добивают команды до размера большей."""
    room = f"lobby-{code}"
    old = games.pop(room, None)
    if old:
        old.task.cancel()
    g = get_game(room)
    g.lobby = code
    g.lobby_teams = teams
    sizes = [sum(1 for t in teams.values() if t == side) for side in ("ct", "t")]
    g.bot_fill = max(sizes) if settings.get("bots") else 0
    g.mode = settings["mode"]
    g.set_map(settings["map"])
    g.rules.update({k: settings[k] for k in DEFAULT_RULES if k in settings})
    return room


social = Social(MAPS, DEFAULT_MAP, start_lobby_game)


async def ws_handler(request):
    ws = web.WebSocketResponse(heartbeat=10)
    await ws.prepare(request)
    player = None
    game = None
    try:
        async for msg in ws:
            if msg.type != WSMsgType.TEXT:
                continue
            try:
                data = json.loads(msg.data)
            except ValueError:
                continue
            if not isinstance(data, dict):
                continue
            kind = data.get("type")

            if kind == "join" and player is None:
                name = str(data.get("name") or "Игрок").strip()[:16] or "Игрок"
                pid = social.pid_by_token(data.get("token"))
                room = str(data.get("room") or "")
                team = None
                if room.startswith("lobby-"):
                    # игра лобби: пускаем только участников, у каждого своя команда
                    game = games.get(room)
                    team = game and game.lobby_teams.get(pid)
                    if not team:
                        await ws.send_str(json.dumps({"type": "denied", "text": "Эта игра лобби уже закончилась"}))
                        break
                elif data.get("mode") == "solo":
                    # оффлайн: своя комната только для этого игрока и ботов
                    game = get_game(f"solo-{id(ws)}")
                    game.solo = True
                    if data.get("difficulty") in DIFFICULTY:
                        game.difficulty = data["difficulty"]
                    try:
                        game.bot_fill = min(max(int(data.get("botFill", MAX_TEAM)), 1), MAX_TEAM)
                    except (TypeError, ValueError):
                        pass
                    if data.get("gameMode") in MODES:
                        game.mode = data["gameMode"]
                    if data.get("map") in MAPS:
                        game.set_map(data["map"])
                else:
                    game = get_game("public")
                    # режим и карту общей игры выбирает тот, кто зашёл первым (потом — /mode и /map)
                    if not game.humans():
                        if data.get("gameMode") in MODES:
                            game.mode = data["gameMode"]
                        if data.get("map") in MAPS and data["map"] != game.map_id:
                            game.set_map(data["map"])
                player = Player(game.next_id, name, team or game.pick_team(), ws)
                player.pid = pid
                player.cheat_ok = cheats_allowed(pid, data.get("ownerKey"))
                if data.get("knife") in KNIVES and social.kills(pid) >= KNIFE_UNLOCK[data["knife"]]:
                    player.knife = data["knife"]   # закрытый нож (мало убийств) — остаётся обычный
                skins = data.get("skins")
                owned = set(social.wallet(pid)["owned"]) if pid in social.profiles else set()
                if isinstance(skins, dict):  # только скины, которые у игрока на самом деле есть
                    player.skins = {k: v for k, v in skins.items()
                                    if k in (*GUNS, "knife", "agent_ct", "agent_t")
                                    and isinstance(v, str) and v in owned}
                game.next_id += 1
                game.spawn(player)
                # в середине раунда новичок ждёт следующего
                if game.phase in ("live", "end"):
                    game.kill_off(player)
                game.players[player.id] = player
                await game.send(player, {
                    "type": "welcome", "id": player.id, "team": player.team,
                    "pos": player.pos, "yaw": player.yaw, "alive": player.alive,
                    "roundsToWin": game.rules["rounds"], "solo": game.solo,
                    "difficulty": game.difficulty, "botFill": game.bot_fill, "mode": game.mode,
                    "map": game.map_id, "rules": game.rules, "lobby": game.lobby,
                    "cheatsAllowed": player.cheat_ok,
                })
                await game.broadcast({"type": "chat", "text": f"{name} подключился"})
                await game.rebalance_bots()
                await social.set_in_game(pid, True)
                print(f"[+] {name} ({player.team}) в {game.room} — людей: {len(game.humans())}", flush=True)

            elif player is None:
                continue

            elif kind == "state" and player.alive:
                try:
                    pos = data.get("pos")
                    if isinstance(pos, list) and len(pos) == 3:
                        player.pos = [float(v) for v in pos]
                    player.yaw = float(data.get("yaw", player.yaw))
                    player.pitch = float(data.get("pitch", player.pitch))
                except (TypeError, ValueError):
                    continue  # кривые числа — пропускаем сообщение
                player.crouch = bool(data.get("crouch"))
                weapon = data.get("weapon")
                if isinstance(weapon, str) and player.owns(weapon):
                    player.weapon = weapon

            elif kind == "shoot" and player.alive:
                game.noise(player)
                await game.broadcast({
                    "type": "shot", "id": player.id,
                    "from": data.get("from"), "to": data.get("to"),
                }, exclude=player.id)

            elif kind == "use":
                game.set_using(player, data.get("active"))  # E: закладка / разминирование

            elif kind == "buy":
                await game.buy(player, data.get("item"))

            elif kind == "throw":
                await game.throw(player, data)

            elif kind == "drop":
                await game.drop(player, data)

            elif kind == "pickup":
                await game.pickup(player, data)

            elif kind == "dropBomb":
                await game.throw_bomb(player, data)

            elif kind == "sell":
                await game.sell(player, data.get("item"))

            elif kind == "cheats" and player.cheat_ok:
                player.cheats = bool(data.get("on"))
                state = "включил" if player.cheats else "выключил"
                await game.broadcast({"type": "chat", "text": f"🛠 {player.name} {state} читы"})

            elif kind == "ownerGrant" and player.cheat_ok and player.pid:
                def amount(v, top):
                    return max(0, min(int(v), top)) if isinstance(v, (int, float)) else 0
                gold, kills = amount(data.get("gold"), 10_000_000), amount(data.get("kills"), 100_000)
                social.owner_grant(player.pid, gold, kills)
                await game.send(player, {"type": "chat", "text": f"🛠 Выдано: {gold} золота, {kills} убийств"})

            elif kind == "swing" and player.alive and data.get("kind") in KNIFE_DMG:
                # взмах ножом — только для анимации у других игроков
                await game.broadcast({"type": "swing", "id": player.id, "kind": data["kind"]}, exclude=player.id)

            elif kind == "hit":
                await game.handle_hit(player, data)

            elif kind == "team" and game.lobby:
                await game.send(player, {"type": "chat", "text": "В игре лобби команды не меняются — их выбирают в лобби"})

            elif kind == "team" and data.get("team") in TEAMS and data["team"] != player.team:
                player.team = data["team"]
                game.spawn(player)
                if game.phase not in ("warmup", "freeze"):
                    game.kill_off(player)  # сменил команду посреди раунда — ждёт следующего
                await game.send(player, {"type": "teamChanged", "team": player.team,
                                         "pos": player.pos, "yaw": player.yaw, "alive": player.alive})
                await game.broadcast({"type": "chat", "text": f"{player.name} перешёл за {TEAM_NAME[player.team]}"})
                await game.rebalance_bots()

            elif kind == "chat":
                text = str(data.get("text", "")).strip()[:120]
                if text.startswith("/") and game.lobby:
                    await game.send(player, {"type": "chat", "text": "В лобби правила меняет хозяин в меню лобби"})
                elif text.startswith("/"):
                    await game.command(player, text)
                elif text:
                    await game.broadcast({"type": "chat", "text": f"{player.name}: {text}", "team": player.team})
    finally:
        if player:
            game.drop_bomb(player)  # вышел с бомбой — она падает на землю
            game.players.pop(player.id, None)
            await game.broadcast({"type": "leave", "id": player.id})
            await game.broadcast({"type": "chat", "text": f"{player.name} вышел"})
            await game.rebalance_bots()
            await social.set_in_game(player.pid, False)
            await close_if_empty(game)
            print(f"[-] {player.name} из {game.room} — людей: {len(game.humans())}", flush=True)
    return ws


async def index(request):
    # к адресам скрипта и стилей дописываем версию (время последнего изменения файлов игры),
    # чтобы после обновления браузер точно загрузил новые, а не взял старые из кэша
    version = int(max(f.stat().st_mtime for f in PUBLIC_DIR.iterdir() if f.is_file()))
    html = (PUBLIC_DIR / "index.html").read_text(encoding="utf-8")
    html = html.replace('href="style.css"', f'href="style.css?v={version}"')
    html = html.replace('src="game.js"', f'src="game.js?v={version}"')
    # номер приложения для входа через Google (если он задан) — страница покажет кнопку входа
    html = html.replace("</head>", f'<meta name="google-client-id" content="{social_mod.GOOGLE_CLIENT_ID}">\n</head>', 1)
    return web.Response(text=html, content_type="text/html")


STATIC_TYPES = {".js": "text/javascript", ".css": "text/css", ".html": "text/html", ".json": "application/json",
                ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".ico": "image/x-icon",
                ".mp3": "audio/mpeg", ".ogg": "audio/ogg", ".wav": "audio/wav", ".webmanifest": "application/manifest+json"}


async def client_log(request):
    """Телефон присылает этапы загрузки и ошибки — печатаем их в окно сервера (на телефоне консоли нет)."""
    text = (await request.text())[:2000]
    if not HOSTED:   # в интернете чужие отчёты только засоряли бы журнал
        print(f"[телефон {request.remote}] {text}", flush=True)
    return web.Response(text="ok")


async def static_file(request):
    """Файлы из public/ отдаём целиком из памяти. Стандартная раздача aiohttp на Windows
    портила большие файлы (game.js приходил с перемешанными кусками — на iPhone игра не запускалась)."""
    path = (PUBLIC_DIR / request.match_info["path"]).resolve()
    if PUBLIC_DIR.resolve() not in path.parents or not path.is_file():
        raise web.HTTPNotFound()
    ctype = STATIC_TYPES.get(path.suffix.lower(), "application/octet-stream")
    charset = "utf-8" if ctype.startswith("text/") or ctype.endswith("json") or ctype.endswith("xml") else None
    return web.Response(body=path.read_bytes(), content_type=ctype, charset=charset)


@web.middleware
async def no_cache(request, handler):
    """Браузер не должен брать файлы игры из кэша — иначе после обновления игры грузится старая версия."""
    response = await handler(request)
    if not isinstance(response, web.WebSocketResponse):
        response.headers["Cache-Control"] = "no-cache"
    return response


def local_ip():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except OSError:
        return "127.0.0.1"


def main():
    if sys.platform == "win32":
        # стандартный цикл Windows пишет ConnectionResetError, когда браузер обрывает соединение
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    app = web.Application(middlewares=[no_cache])
    app.on_startup.append(social.start)    # на хостинге — прочитать профили из базы до первого игрока
    app.on_shutdown.append(social.stop)    # выключение/обновление — дописать несохранённое
    app.router.add_get("/", index)
    app.router.add_get("/ws", ws_handler)
    app.router.add_get("/social", social.handler)
    app.router.add_post("/clientlog", client_log)
    app.router.add_get("/{path:.+}", static_file)
    print("=" * 50)
    print(" Strike Arena сервер запущен!")
    print(f" На этом компьютере:  http://localhost:{PORT}")
    print(f" Друзьям в той же Wi-Fi сети:  http://{local_ip()}:{PORT}")
    print("=" * 50)
    web.run_app(app, host="0.0.0.0", port=PORT, print=None)


if __name__ == "__main__":
    main()
