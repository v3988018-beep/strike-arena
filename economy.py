"""Экономика игры: золото, скины, кейсы, награды и рынок.

Всё считает сервер — браузер только показывает кошелёк и присылает просьбы («открой кейс», «купи скин»).
Иначе любой мог бы нарисовать себе золото в браузере и продать на рынке скин, которого у него нет.

Кошелёк лежит в профиле: profile["wallet"] =
  {v, gold, owned: [id], equipped: {оружие: id}, knifeSkins: {тип ножа: id}, freeCases: {кейс: n},
   rewardLevel, missions: {day, list: [{id, p, claimed}]}, dailyDay, streak, got: {id: когда получен}}
Каталог скинов, кейсов и наград — public/catalog.json (тот же файл читает игра в браузере).
"""
import json
import random
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

CATALOG = json.loads((Path(__file__).parent / "public" / "catalog.json").read_text(encoding="utf-8"))
RARITY = CATALOG["rarity"]
REWARDS = CATALOG["rewards"]
MARKET = CATALOG["market"]
MISSIONS = {m["id"]: m for m in CATALOG["missions"]}
SHOP_RARITIES = set(CATALOG["shopRarities"])   # остальное (эпики, легендарки, ножи) — только из кейсов и с рынка
CASES = {c["id"]: c for c in CATALOG["cases"]}

# Окраски ножей — заготовки: каждая есть на каждом типе ножа отдельно ("kn_fade@karambit"), как в игре
KNIFE_TYPES = ("default", "stiletto", "skeleton", "karambit", "butterfly", "m9")
_finishes = [s for s in CATALOG["skins"] if s["weapon"] == "knife"]
SKINS = [s for s in CATALOG["skins"] if s["weapon"] != "knife"] + [
    {**f, "id": f"{f['id']}@{t}", "knife": t} for t in KNIFE_TYPES for f in _finishes]
SKIN_BY_ID = {s["id"]: s for s in SKINS}
SLOTS = ("rifle", "awp", "pistol", "deagle", "m4", "smg", "shotgun", "agent_ct", "agent_t")

V = 2                      # версия кошелька: 2 — считает сервер
MIGRATE_GOLD_CAP = 5000    # старые кошельки считал браузер — золото выше этого сбрасывается
MIGRATE_FREE_CASES_CAP = 10


def is_agent(s):
    return s["weapon"].startswith("agent")


def case_pool(c):
    kind = c["pool"]
    if kind == "guns":
        return [s for s in SKINS if s["weapon"] != "knife" and not is_agent(s)]
    if kind == "agents":
        return [s for s in SKINS if is_agent(s)]
    return [s for s in SKINS if not is_agent(s)]   # noagents: оружие и ножи


POOLS = {cid: case_pool(c) for cid, c in CASES.items()}


def price_of(skin_id):
    return RARITY[SKIN_BY_ID[skin_id]["rarity"]]["price"]


# ---------- время: день наград — по Гринвичу, одинаковый для всех игроков ----------
def today(now=None):
    return datetime.fromtimestamp(now or time.time(), timezone.utc).strftime("%Y-%m-%d")


def yesterday(now=None):
    return (datetime.fromtimestamp(now or time.time(), timezone.utc) - timedelta(days=1)).strftime("%Y-%m-%d")


def seconds_to_reset(now=None):
    d = datetime.fromtimestamp(now or time.time(), timezone.utc)
    midnight = (d + timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
    return int((midnight - d).total_seconds())


# ---------- кошелёк ----------
def new_wallet():
    return {"v": V, "gold": REWARDS["startGold"], "owned": [], "equipped": {}, "knifeSkins": {}, "freeCases": {},
            "rewardLevel": None, "missions": None, "dailyDay": None, "streak": 0, "got": {}}


def migrate(old):
    """Кошелёк из профиля → в порядок. Старый (его считал браузер) переносим осторожно:
    скины оставляем (только те, что есть в каталоге), золото — не больше MIGRATE_GOLD_CAP."""
    if not isinstance(old, dict):
        return None
    w = new_wallet()
    fresh = old.get("v") != V
    try:
        gold = int(old.get("gold", 0))
    except (TypeError, ValueError):
        gold = 0
    w["gold"] = max(0, min(gold, MIGRATE_GOLD_CAP) if fresh else gold)
    w["owned"] = list(dict.fromkeys(i for i in old.get("owned") or [] if isinstance(i, str) and i in SKIN_BY_ID))
    owned = set(w["owned"])
    for slot, sid in (old.get("equipped") or {}).items():
        if slot in SLOTS and sid in owned and SKIN_BY_ID[sid]["weapon"] == slot:
            w["equipped"][slot] = sid
    for t, sid in (old.get("knifeSkins") or {}).items():
        if t in KNIFE_TYPES and sid in owned and SKIN_BY_ID[sid].get("knife") == t:
            w["knifeSkins"][t] = sid
    for cid, n in (old.get("freeCases") or {}).items():
        if cid in CASES and isinstance(n, int) and n > 0:
            w["freeCases"][cid] = min(n, MIGRATE_FREE_CASES_CAP) if fresh else n
    if isinstance(old.get("rewardLevel"), int):
        w["rewardLevel"] = old["rewardLevel"]
    if isinstance(old.get("dailyDay"), str):
        w["dailyDay"] = old["dailyDay"]
    if isinstance(old.get("streak"), int):
        w["streak"] = max(0, min(old["streak"], 30))
    if not fresh:
        w["missions"] = old.get("missions")
        w["got"] = {k: v for k, v in (old.get("got") or {}).items() if k in owned}
    return w


def public(w, now=None):
    """Что видит браузер: кошелёк плюс готовые подсказки (награда дня, задания, когда сброс)."""
    ensure_missions(w, now)
    streak = next_streak(w, now)
    lock = MARKET["tradeLockHours"] * 3600
    t = now or time.time()
    return {
        "gold": w["gold"], "owned": w["owned"], "equipped": w["equipped"], "knifeSkins": w["knifeSkins"],
        "freeCases": w["freeCases"], "missions": w["missions"], "streak": w["streak"],
        "daily": {"ready": w["dailyDay"] != today(now), "amount": daily_amount(streak), "streak": streak,
                  "tomorrow": daily_amount(w["streak"] + 1)},
        "resetIn": seconds_to_reset(now),
        # скины, которые пока нельзя продать (недавно получены): id → через сколько секунд можно
        "locked": {k: int(v + lock - t) for k, v in w["got"].items() if v + lock > t},
    }


def add_gold(w, n):
    w["gold"] = max(0, w["gold"] + int(n))


def give_skin(w, skin_id, now=None):
    if skin_id not in w["owned"]:
        w["owned"].append(skin_id)
    w["got"][skin_id] = now or time.time()


def take_skin(w, skin_id):
    """Убрать скин из кошелька (продажа): и из надетого тоже."""
    if skin_id in w["owned"]:
        w["owned"].remove(skin_id)
    s = SKIN_BY_ID.get(skin_id)
    if s and w["equipped"].get(s["weapon"]) == skin_id:
        del w["equipped"][s["weapon"]]
    if s and s.get("knife") and w["knifeSkins"].get(s["knife"]) == skin_id:
        del w["knifeSkins"][s["knife"]]
    w["got"].pop(skin_id, None)


# ---------- покупки ----------
def buy_skin(w, skin_id, now=None):
    if skin_id not in SKIN_BY_ID or skin_id in w["owned"] or SKIN_BY_ID[skin_id]["rarity"] not in SHOP_RARITIES:
        return False
    price = price_of(skin_id)
    if w["gold"] < price:
        return False
    w["gold"] -= price
    give_skin(w, skin_id, now)
    return True


def roll_case(case_id, rng=random):
    """Сначала редкость по весам, потом случайный скин этой редкости — как показано в окне шансов."""
    c, pool = CASES[case_id], POOLS[case_id]
    rars = [r for r in c["weights"] if any(s["rarity"] == r for s in pool)]
    x = rng.random() * sum(c["weights"][r] for r in rars)
    rar = rars[0]
    for r in rars:
        x -= c["weights"][r]
        if x < 0:
            rar = r
            break
    return rng.choice([s for s in pool if s["rarity"] == rar])


def open_case(w, case_id, rng=random, now=None):
    """Открыть кейс: бесплатный (за уровень) или за золото. Повтор скина — часть цены золотом.
    Возвращает {won, dupe, refund} или None, если нельзя."""
    if case_id not in CASES:
        return None
    free = w["freeCases"].get(case_id, 0) > 0
    if not free and w["gold"] < CASES[case_id]["price"]:
        return None
    if free:
        w["freeCases"][case_id] -= 1
        if not w["freeCases"][case_id]:
            del w["freeCases"][case_id]
    else:
        w["gold"] -= CASES[case_id]["price"]
    won = roll_case(case_id, rng)
    dupe = won["id"] in w["owned"]
    refund = round(RARITY[won["rarity"]]["price"] * REWARDS["dupeRefund"]) if dupe else 0
    if dupe:
        w["gold"] += refund
    else:
        give_skin(w, won["id"], now)
    return {"won": won["id"], "dupe": dupe, "refund": refund}


def equip(w, slot, skin_id):
    """Надеть скин (или снять: skin_id = None). Ножи — отдельно на каждый тип ножа."""
    if slot == "knife":
        s = SKIN_BY_ID.get(skin_id)
        if not s or not s.get("knife") or skin_id not in w["owned"]:
            return False
        w["knifeSkins"][s["knife"]] = skin_id
        return True
    if slot.startswith("knife:"):          # снять скин с ножа этого типа
        w["knifeSkins"].pop(slot[6:], None)
        return True
    if slot not in SLOTS:
        return False
    if skin_id is None:
        w["equipped"].pop(slot, None)
        return True
    if skin_id not in w["owned"] or SKIN_BY_ID[skin_id]["weapon"] != slot:
        return False
    w["equipped"][slot] = skin_id
    return True


# ---------- награды ----------
def daily_amount(streak):
    d = REWARDS["daily"]
    return min(d["max"], d["base"] + d["step"] * (max(1, streak) - 1))


def next_streak(w, now=None):
    """Каким по счёту днём серии будет награда, если забрать её сегодня."""
    return w["streak"] + 1 if w["dailyDay"] == yesterday(now) else 1


def claim_daily(w, now=None):
    if w["dailyDay"] == today(now):
        return 0
    w["streak"] = next_streak(w, now)
    w["dailyDay"] = today(now)
    amount = daily_amount(w["streak"])
    w["gold"] += amount
    return amount


def level_reward(level):
    r = REWARDS["level"]
    case = "knife" if level % r["knifeCaseEvery"] == 0 else "weapon" if level % r["weaponCaseEvery"] == 0 else None
    return {"gold": r["goldBase"] + r["goldPerLevel"] * level, "case": case}


def level_up(w, level):
    """Награды за все новые уровни (золото и кейсы за каждый 5-й/10-й). Возвращает список выданного."""
    if w["rewardLevel"] is None:
        w["rewardLevel"] = 1
    got = []
    while w["rewardLevel"] < level:
        w["rewardLevel"] += 1
        r = level_reward(w["rewardLevel"])
        w["gold"] += r["gold"]
        if r["case"]:
            w["freeCases"][r["case"]] = w["freeCases"].get(r["case"], 0) + 1
        got.append({"level": w["rewardLevel"], **r})
    return got


def _daily_missions(day):
    """Три задания дня — одинаковые у всех (выбор зависит только от даты)."""
    seed = 7
    for ch in day:
        seed = (seed * 31 + ord(ch)) & 0xFFFFFFFF
    pool = list(MISSIONS)
    picked = []
    while len(picked) < 3:
        seed = (seed * 1103515245 + 12345) & 0xFFFFFFFF
        picked.append(pool.pop(int(seed / 2 ** 32 * len(pool))))
    return picked


def ensure_missions(w, now=None):
    day = today(now)
    if not isinstance(w.get("missions"), dict) or w["missions"].get("day") != day:
        w["missions"] = {"day": day, "list": [{"id": m, "p": 0, "claimed": False} for m in _daily_missions(day)]}


def mission_event(w, events, now=None):
    """Событие из матча ('kill', 'kill:awp', 'head', 'round', 'mvp', 'jump', 'wallbang') — прогресс заданий.
    Возвращает задания, которые только что выполнены."""
    ensure_missions(w, now)
    done = []
    for m in w["missions"]["list"]:
        d = MISSIONS[m["id"]]
        if d["ev"] in events and m["p"] < d["n"]:
            m["p"] += 1
            if m["p"] == d["n"]:
                done.append(d)
    return done


def claim_mission(w, index, now=None):
    ensure_missions(w, now)
    lst = w["missions"]["list"]
    if not isinstance(index, int) or not 0 <= index < len(lst):
        return 0
    m, d = lst[index], MISSIONS[lst[index]["id"]]
    if m["claimed"] or m["p"] < d["n"]:
        return 0
    m["claimed"] = True
    w["gold"] += d["gold"]
    return d["gold"]


# ---------- рынок ----------
class Market:
    """Игроки продают друг другу скины за золото. Выставленный скин уходит из инвентаря (лежит «на витрине»),
    при покупке золото получает продавец минус комиссия — она сгорает, чтобы золота в игре не становилось слишком много."""

    def __init__(self, data=None):
        data = data if isinstance(data, dict) else {}
        self.listings = {lot["id"]: lot for lot in data.get("listings", []) if lot.get("skin") in SKIN_BY_ID}
        self.next_id = int(data.get("next", 1))
        self.history = {k: v[-20:] for k, v in (data.get("history") or {}).items() if k in SKIN_BY_ID}

    def dump(self):
        return {"listings": list(self.listings.values()), "next": self.next_id, "history": self.history}

    def mine(self, pid):
        return [lot for lot in self.listings.values() if lot["seller"] == pid]

    def sell(self, pid, w, skin_id, price, now=None):
        """Выставить скин. Возвращает (лот, None) или (None, причина)."""
        now = now or time.time()
        if skin_id not in w["owned"]:
            return None, "Этого скина нет в инвентаре"
        if not isinstance(price, int) or not MARKET["minPrice"] <= price <= MARKET["maxPrice"]:
            return None, f"Цена — от {MARKET['minPrice']} до {MARKET['maxPrice']}"
        if w["got"].get(skin_id, 0) + MARKET["tradeLockHours"] * 3600 > now:
            return None, f"Новый скин можно продать через {MARKET['tradeLockHours']} ч после получения"
        if len(self.mine(pid)) >= MARKET["maxListings"]:
            return None, f"Не больше {MARKET['maxListings']} лотов одновременно"
        take_skin(w, skin_id)
        lot = {"id": self.next_id, "seller": pid, "skin": skin_id, "price": price, "at": now}
        self.next_id += 1
        self.listings[lot["id"]] = lot
        return lot, None

    def cancel(self, pid, w, lot_id):
        """Снять свой лот: скин возвращается (если такой уже есть снова — вместо него часть цены золотом)."""
        lot = self.listings.get(lot_id)
        if not lot or lot["seller"] != pid:
            return False
        del self.listings[lot_id]
        if lot["skin"] in w["owned"]:
            w["gold"] += round(price_of(lot["skin"]) * REWARDS["dupeRefund"])
        else:
            w["owned"].append(lot["skin"])   # trade-lock не начинается заново
        return True

    def buy(self, pid, w, lot_id, seller_w, now=None):
        """Купить лот. Возвращает (лот, сколько получил продавец, None) или (None, 0, причина)."""
        lot = self.listings.get(lot_id)
        if not lot:
            return None, 0, "Этот лот уже купили или сняли"
        if lot["seller"] == pid:
            return None, 0, "Это твой лот"
        if lot["skin"] in w["owned"]:
            return None, 0, "Такой скин у тебя уже есть"
        if w["gold"] < lot["price"]:
            return None, 0, "Не хватает золота"
        del self.listings[lot_id]
        w["gold"] -= lot["price"]
        give_skin(w, lot["skin"], now)
        earned = lot["price"] - int(lot["price"] * MARKET["fee"])
        if seller_w is not None:
            seller_w["gold"] += earned
        hist = self.history.setdefault(lot["skin"], [])
        hist.append([lot["price"], int(now or time.time())])
        del hist[:-20]
        return lot, earned, None
