import { BridgeGameState, BridgeScore, Card, Contract, PlayerPosition, Strain, Trick } from "./types";
import {
  cloneState,
  getSideByPosition,
  getUndoubledContractPoints,
  nextPosition,
  oppositeSide,
  POSITIONS,
  RANK_VALUE,
  sameCard,
  Side,
} from "./BridgeGameShared";

interface MadeScoreBreakdown {
  contractPoints: number;
  overtrickPoints: number;
  gameBonus: number;
  slamBonus: number;
  insultBonus: number;
  totalPoints: number;
}

export class PlayPhase {
  constructor(private readonly state: BridgeGameState) {}

  public submitCard(playerId: string, card: Card): void {
    if (this.state.phase !== "playing") {
      throw new Error("Playing phase is not active.");
    }

    const position = this.getPlayerPositionById(playerId);
    if (this.state.turn !== position) {
      throw new Error("It is not this player's turn to play.");
    }

    const hand = this.state.hands[position];
    const idx = hand.findIndex((candidate) => sameCard(candidate, card));
    if (idx === -1) {
      throw new Error("Card does not exist in player's hand.");
    }

    if (this.state.currentTrick?.cards.length) {
      const leadSuit = this.state.currentTrick.cards[0].card.suit;
      const hasLeadSuit = hand.some((candidate) => candidate.suit === leadSuit);
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

    if (!this.state.isDummyRevealed && this.state.tricks.length === 0 && this.state.currentTrick.cards.length === 1) {
      this.state.isDummyRevealed = true;
    }

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
      return;
    }

    this.state.turn = nextPosition(position);
  }

  public getState(): BridgeGameState {
    return cloneState(this.state);
  }

  private getPlayerPositionById(playerId: string): PlayerPosition {
    for (const position of POSITIONS) {
      if (this.state.playersByPosition[position] === playerId) {
        return position;
      }
    }

    throw new Error("Player is not seated in this game.");
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
      return {
        contractResult: "passed-out",
        nsPoints: 0,
        ewPoints: 0,
        winnerSide: "tie",
        playerPoints: this.buildPlayerPoints(0, 0),
      };
    }

    const contract = this.state.contract;
    const declarerSide = contract.side;
    const targetTricks = 6 + contract.level;

    const tricksWonByDeclarerSide = this.state.tricks.filter((trick) => {
      if (!trick.winner) {
        return false;
      }

      return getSideByPosition(trick.winner) === declarerSide;
    }).length;

    if (tricksWonByDeclarerSide >= targetTricks) {
      const overtricks = tricksWonByDeclarerSide - targetTricks;
      const breakdown = this.calculateMadeScore(contract, overtricks);
      const nsPoints = declarerSide === "NS" ? breakdown.totalPoints : 0;
      const ewPoints = declarerSide === "EW" ? breakdown.totalPoints : 0;

      return {
        contractResult: "made",
        declarerSide,
        contractLevel: contract.level,
        strain: contract.strain,
        tricksWonByDeclarerSide,
        targetTricks,
        overtricks,
        contractPoints: breakdown.contractPoints,
        overtrickPoints: breakdown.overtrickPoints,
        bonusPoints: breakdown.gameBonus + breakdown.slamBonus + breakdown.insultBonus,
        penaltyPoints: 0,
        gameBonus: breakdown.gameBonus,
        slamBonus: breakdown.slamBonus,
        insultBonus: breakdown.insultBonus,
        doubled: contract.doubled,
        redoubled: contract.redoubled,
        isGameContract: contract.isGameContract,
        nsPoints,
        ewPoints,
        winnerSide: nsPoints > ewPoints ? "NS" : ewPoints > nsPoints ? "EW" : "tie",
        loserSide: nsPoints > ewPoints ? "EW" : ewPoints > nsPoints ? "NS" : undefined,
        playerPoints: this.buildPlayerPoints(nsPoints, ewPoints),
      };
    }

    const undertricks = targetTricks - tricksWonByDeclarerSide;
    const defenders = oppositeSide(declarerSide);
    const penaltyPoints = this.calculateUndertrickPenalty(contract, undertricks);
    const nsPoints = defenders === "NS" ? penaltyPoints : 0;
    const ewPoints = defenders === "EW" ? penaltyPoints : 0;

    return {
      contractResult: "down",
      declarerSide,
      contractLevel: contract.level,
      strain: contract.strain,
      tricksWonByDeclarerSide,
      targetTricks,
      undertricks,
      contractPoints: 0,
      overtrickPoints: 0,
      bonusPoints: 0,
      penaltyPoints,
      gameBonus: 0,
      slamBonus: 0,
      insultBonus: 0,
      doubled: contract.doubled,
      redoubled: contract.redoubled,
      isGameContract: contract.isGameContract,
      nsPoints,
      ewPoints,
      winnerSide: nsPoints > ewPoints ? "NS" : ewPoints > nsPoints ? "EW" : "tie",
      loserSide: nsPoints > ewPoints ? "EW" : ewPoints > nsPoints ? "NS" : undefined,
      playerPoints: this.buildPlayerPoints(nsPoints, ewPoints),
    };
  }

  private calculateMadeScore(contract: Contract, overtricks: number): MadeScoreBreakdown {
    const undoubledContractPoints = getUndoubledContractPoints(contract.level, contract.strain);
    const multiplier = contract.redoubled ? 4 : contract.doubled ? 2 : 1;
    const contractPoints = undoubledContractPoints * multiplier;

    let overtrickPoints = 0;
    if (overtricks > 0) {
      if (contract.redoubled) {
        overtrickPoints = overtricks * 200;
      } else if (contract.doubled) {
        overtrickPoints = overtricks * 100;
      } else if (contract.strain === "C" || contract.strain === "D") {
        overtrickPoints = overtricks * 20;
      } else {
        overtrickPoints = overtricks * 30;
      }
    }

    const gameBonus = contract.isGameContract ? 300 : 50;
    const slamBonus = contract.level === 6 ? 500 : contract.level === 7 ? 1000 : 0;
    const insultBonus = contract.redoubled ? 100 : contract.doubled ? 50 : 0;

    return {
      contractPoints,
      overtrickPoints,
      gameBonus,
      slamBonus,
      insultBonus,
      totalPoints: contractPoints + overtrickPoints + gameBonus + slamBonus + insultBonus,
    };
  }

  private calculateUndertrickPenalty(contract: Contract, undertricks: number): number {
    if (!contract.doubled && !contract.redoubled) {
      return undertricks * 50;
    }

    const factor = contract.redoubled ? 2 : 1;
    let penalty = 0;

    for (let index = 1; index <= undertricks; index += 1) {
      if (index === 1) {
        penalty += 100;
      } else if (index <= 3) {
        penalty += 200;
      } else {
        penalty += 300;
      }
    }

    return penalty * factor;
  }

  private buildPlayerPoints(nsPoints: number, ewPoints: number): Record<string, number> {
    return {
      [this.state.playersByPosition.N]: nsPoints,
      [this.state.playersByPosition.S]: nsPoints,
      [this.state.playersByPosition.E]: ewPoints,
      [this.state.playersByPosition.W]: ewPoints,
    };
  }
}