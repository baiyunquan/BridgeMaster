import {
  Bid,
  BidEntry,
  BridgeGameState,
  BridgeScore,
  Card,
  Contract,
  PlayerPosition,
  Strain,
  Suit,
  Trick,
} from "./types";

const POSITIONS: PlayerPosition[] = ["N", "E", "S", "W"];
const SUITS: Suit[] = ["C", "D", "H", "S"];
const RANKS: Card["rank"][] = [
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  "10",
  "J",
  "Q",
  "K",
  "A",
];

const RANK_VALUE: Record<Card["rank"], number> = {
  "2": 2,
  "3": 3,
  "4": 4,
  "5": 5,
  "6": 6,
  "7": 7,
  "8": 8,
  "9": 9,
  "10": 10,
  J: 11,
  Q: 12,
  K: 13,
  A: 14,
};

const STRAIN_ORDER: Record<Strain, number> = {
  C: 1,
  D: 2,
  H: 3,
  S: 4,
  NT: 5,
};

type Side = "NS" | "EW";

function sameCard(a: Card, b: Card): boolean {
  return a.suit === b.suit && a.rank === b.rank;
}

function getSideByPosition(position: PlayerPosition): Side {
  return position === "N" || position === "S" ? "NS" : "EW";
}

function nextPosition(position: PlayerPosition): PlayerPosition {
  const idx = POSITIONS.indexOf(position);
  return POSITIONS[(idx + 1) % POSITIONS.length];
}

function compareBidRank(level: number, strain: Strain): number {
  return level * 10 + STRAIN_ORDER[strain];
}

function cloneState(state: BridgeGameState): BridgeGameState {
  return JSON.parse(JSON.stringify(state)) as BridgeGameState;
}

export class BridgeGame {
  private state: BridgeGameState;

  constructor(playersByPosition: Record<PlayerPosition, string>) {
    this.state = {
      phase: "waiting",
      dealer: "N",
      turn: null,
      playersByPosition,
      hands: { N: [], E: [], S: [], W: [] },
      bidHistory: [],
      contract: null,
      tricks: [],
      currentTrick: null,
      score: null,
    };
  }

  public getState(): BridgeGameState {
    return cloneState(this.state);
  }

  public start(): BridgeGameState {
    if (this.state.phase !== "waiting") {
      throw new Error("Game already started.");
    }

    const deck = this.buildShuffledDeck();
    const hands: Record<PlayerPosition, Card[]> = { N: [], E: [], S: [], W: [] };

    for (let i = 0; i < deck.length; i += 1) {
      const position = POSITIONS[i % POSITIONS.length];
      hands[position].push(deck[i]);
    }

    for (const position of POSITIONS) {
      hands[position].sort((a, b) => {
        if (a.suit !== b.suit) {
          return SUITS.indexOf(a.suit) - SUITS.indexOf(b.suit);
        }
        return RANK_VALUE[a.rank] - RANK_VALUE[b.rank];
      });
    }

    this.state.hands = hands;
    this.state.phase = "bidding";
    this.state.turn = this.state.dealer;
    this.state.bidHistory = [];
    this.state.contract = null;
    this.state.tricks = [];
    this.state.currentTrick = null;
    this.state.score = null;

    return this.getState();
  }

  public submitBid(playerId: string, bid: Bid): BridgeGameState {
    if (this.state.phase !== "bidding") {
      throw new Error("Bidding phase is not active.");
    }

    const position = this.getPlayerPositionById(playerId);
    if (this.state.turn !== position) {
      throw new Error("It is not this player's turn to bid.");
    }

    this.validateBid(position, bid);

    const entry: BidEntry = {
      playerId,
      position,
      bid,
      timestamp: Date.now(),
    };
    this.state.bidHistory.push(entry);

    if (this.shouldEndAuction()) {
      this.finishAuction();
    } else {
      this.state.turn = nextPosition(position);
    }

    return this.getState();
  }

  public submitCard(playerId: string, card: Card): BridgeGameState {
    if (this.state.phase !== "playing") {
      throw new Error("Playing phase is not active.");
    }

    const position = this.getPlayerPositionById(playerId);
    if (this.state.turn !== position) {
      throw new Error("It is not this player's turn to play.");
    }

    const hand = this.state.hands[position];
    const idx = hand.findIndex((c) => sameCard(c, card));
    if (idx === -1) {
      throw new Error("Card does not exist in player's hand.");
    }

    if (this.state.currentTrick?.cards.length) {
      const leadSuit = this.state.currentTrick.cards[0].card.suit;
      const hasLeadSuit = hand.some((c) => c.suit === leadSuit);
      if (hasLeadSuit && card.suit !== leadSuit) {
        throw new Error("Must follow suit when possible.");
      }
    }

    hand.splice(idx, 1);

    if (!this.state.currentTrick) {
      this.state.currentTrick = {
        leader: position,
        cards: [],
      };
    }

    this.state.currentTrick.cards.push({
      playerId,
      position,
      card,
    });

    if (this.state.currentTrick.cards.length === 4) {
      const finishedTrick = this.resolveCurrentTrick();
      this.state.tricks.push(finishedTrick);
      this.state.currentTrick = null;

      if (this.state.tricks.length === 13) {
        this.state.phase = "finished";
        this.state.turn = null;
        this.state.score = this.calculateScore();
      } else {
        this.state.turn = finishedTrick.winner ?? null;
      }
    } else {
      this.state.turn = nextPosition(position);
    }

    return this.getState();
  }

  private buildShuffledDeck(): Card[] {
    const deck: Card[] = [];
    for (const suit of SUITS) {
      for (const rank of RANKS) {
        deck.push({ suit, rank });
      }
    }

    for (let i = deck.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }

    return deck;
  }

  private getPlayerPositionById(playerId: string): PlayerPosition {
    for (const position of POSITIONS) {
      if (this.state.playersByPosition[position] === playerId) {
        return position;
      }
    }
    throw new Error("Player is not seated in this game.");
  }

  private validateBid(position: PlayerPosition, bid: Bid): void {
    if (bid.type === "pass") {
      return;
    }

    const highestContract = this.getHighestContractFromBids();
    const side = getSideByPosition(position);
    const lastCall = this.getLastNonPassCall();

    if (bid.type === "bid") {
      if (!bid.level || !bid.strain) {
        throw new Error("A normal bid must include level and strain.");
      }

      if (highestContract) {
        const current = compareBidRank(highestContract.level, highestContract.strain);
        const incoming = compareBidRank(bid.level, bid.strain);
        if (incoming <= current) {
          throw new Error("Bid must be higher than the current contract.");
        }
      }
      return;
    }

    if (!highestContract) {
      throw new Error("Cannot double/redouble before any contract bid.");
    }

    if (bid.type === "double") {
      if (highestContract.side === side) {
        throw new Error("Cannot double your own side's contract.");
      }
      if (!lastCall || lastCall.bid.type !== "bid") {
        throw new Error("Double is only valid immediately over an opponent contract bid.");
      }
      return;
    }

    if (bid.type === "redouble") {
      if (!lastCall || lastCall.bid.type !== "double") {
        throw new Error("Redouble is only valid immediately after a double.");
      }
      if (getSideByPosition(lastCall.position) === side) {
        throw new Error("Cannot redouble your own double.");
      }
      return;
    }

    throw new Error("Unknown bid type.");
  }

  private shouldEndAuction(): boolean {
    const calls = this.state.bidHistory;
    if (calls.length < 4) {
      return false;
    }

    const last3 = calls.slice(-3);
    const allPass = last3.every((entry) => entry.bid.type === "pass");
    if (!allPass) {
      return false;
    }

    return this.getHighestContractFromBids() !== null || calls.slice(0, 4).every((c) => c.bid.type === "pass");
  }

  private finishAuction(): void {
    const winningContract = this.getHighestContractFromBids();

    if (!winningContract) {
      this.state.phase = "finished";
      this.state.turn = null;
      this.state.contract = null;
      this.state.score = {
        contractResult: "passed-out",
      };
      return;
    }

    this.state.contract = winningContract;
    this.state.phase = "playing";
    this.state.currentTrick = null;
    this.state.tricks = [];
    this.state.turn = nextPosition(winningContract.declarer);
  }

  private getHighestContractFromBids(): Contract | null {
    let highest: {
      level: number;
      strain: Strain;
      position: PlayerPosition;
    } | null = null;

    for (const call of this.state.bidHistory) {
      if (call.bid.type !== "bid" || !call.bid.level || !call.bid.strain) {
        continue;
      }

      if (
        !highest ||
        compareBidRank(call.bid.level, call.bid.strain) > compareBidRank(highest.level, highest.strain)
      ) {
        highest = {
          level: call.bid.level,
          strain: call.bid.strain,
          position: call.position,
        };
      }
    }

    if (!highest) {
      return null;
    }

    const side = getSideByPosition(highest.position);
    const declarer = this.findDeclarer(side, highest.strain);
    const callSinceHighest = this.state.bidHistory
      .slice()
      .reverse()
      .find((entry) => entry.bid.type === "bid" || entry.bid.type === "double" || entry.bid.type === "redouble");

    return {
      level: highest.level as 1 | 2 | 3 | 4 | 5 | 6 | 7,
      strain: highest.strain,
      declarer,
      side,
      doubled: callSinceHighest?.bid.type === "double",
      redoubled: callSinceHighest?.bid.type === "redouble",
    };
  }

  private findDeclarer(side: Side, strain: Strain): PlayerPosition {
    for (const call of this.state.bidHistory) {
      if (call.bid.type !== "bid") {
        continue;
      }
      if (getSideByPosition(call.position) !== side) {
        continue;
      }
      if (call.bid.strain !== strain) {
        continue;
      }
      return call.position;
    }

    throw new Error("Cannot determine declarer.");
  }

  private getLastNonPassCall(): BidEntry | null {
    for (let i = this.state.bidHistory.length - 1; i >= 0; i -= 1) {
      if (this.state.bidHistory[i].bid.type !== "pass") {
        return this.state.bidHistory[i];
      }
    }
    return null;
  }

  private resolveCurrentTrick(): Trick {
    if (!this.state.currentTrick || this.state.currentTrick.cards.length !== 4) {
      throw new Error("Trick is not complete.");
    }

    const trick = this.state.currentTrick;
    const leadSuit = trick.cards[0].card.suit;
    const trump = this.state.contract?.strain === "NT" ? null : this.state.contract?.strain ?? null;

    let winner = trick.cards[0];

    for (const play of trick.cards.slice(1)) {
      const winnerIsTrump = trump ? winner.card.suit === trump : false;
      const playIsTrump = trump ? play.card.suit === trump : false;

      if (playIsTrump && !winnerIsTrump) {
        winner = play;
        continue;
      }

      if (playIsTrump && winnerIsTrump && RANK_VALUE[play.card.rank] > RANK_VALUE[winner.card.rank]) {
        winner = play;
        continue;
      }

      if (!winnerIsTrump && !playIsTrump) {
        const winnerFollowsLead = winner.card.suit === leadSuit;
        const playFollowsLead = play.card.suit === leadSuit;

        if (!winnerFollowsLead && playFollowsLead) {
          winner = play;
          continue;
        }

        if (
          winnerFollowsLead &&
          playFollowsLead &&
          RANK_VALUE[play.card.rank] > RANK_VALUE[winner.card.rank]
        ) {
          winner = play;
        }
      }
    }

    return {
      leader: trick.leader,
      cards: [...trick.cards],
      winner: winner.position,
    };
  }

  private calculateScore(): BridgeScore {
    if (!this.state.contract) {
      return { contractResult: "passed-out" };
    }

    const declarerSide = this.state.contract.side;
    const targetTricks = 6 + this.state.contract.level;

    const tricksWonByDeclarerSide = this.state.tricks.filter((trick) => {
      if (!trick.winner) {
        return false;
      }
      return getSideByPosition(trick.winner) === declarerSide;
    }).length;

    if (tricksWonByDeclarerSide >= targetTricks) {
      return {
        contractResult: "made",
        declarerSide,
        contractLevel: this.state.contract.level,
        strain: this.state.contract.strain,
        tricksWonByDeclarerSide,
        targetTricks,
        overtricks: tricksWonByDeclarerSide - targetTricks,
      };
    }

    return {
      contractResult: "down",
      declarerSide,
      contractLevel: this.state.contract.level,
      strain: this.state.contract.strain,
      tricksWonByDeclarerSide,
      targetTricks,
      undertricks: targetTricks - tricksWonByDeclarerSide,
    };
  }
}
