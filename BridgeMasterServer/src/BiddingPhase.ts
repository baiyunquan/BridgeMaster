import { Bid, BidEntry, BridgeGameState, Contract, PlayerPosition, Strain } from "./types";
import {
  compareBidRank,
  getSideByPosition,
  isGameContract,
  nextPosition,
  Side,
} from "./BridgeGameShared";

interface AuctionStatus {
  highestBid: (BidEntry & { bid: Bid & { type: "bid"; level: 1 | 2 | 3 | 4 | 5 | 6 | 7; strain: Strain } }) | null;
  doubled: boolean;
  redoubled: boolean;
}

export class BiddingPhase {
  constructor(private readonly state: BridgeGameState) {}

  public submitBid(playerId: string, bid: Bid): void {
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
  }

  private getPlayerPositionById(playerId: string): PlayerPosition {
    for (const [position, assignedPlayerId] of Object.entries(this.state.playersByPosition) as Array<
      [PlayerPosition, string]
    >) {
      if (assignedPlayerId === playerId) {
        return position;
      }
    }

    throw new Error("Player is not seated in this game.");
  }

  private validateBid(position: PlayerPosition, bid: Bid): void {
    const status = this.getAuctionStatus();
    const side = getSideByPosition(position);

    if (bid.type === "pass") {
      return;
    }

    if (bid.type === "bid") {
      if (!bid.level || !bid.strain) {
        throw new Error("A normal bid must include level and strain.");
      }

      if (status.highestBid) {
        const current = compareBidRank(status.highestBid.bid.level, status.highestBid.bid.strain);
        const incoming = compareBidRank(bid.level, bid.strain);
        if (incoming <= current) {
          throw new Error("Bid must be higher than the current contract.");
        }
      }
      return;
    }

    if (!status.highestBid) {
      throw new Error("Cannot double/redouble before any contract bid.");
    }

    if (bid.type === "double") {
      if (status.highestBid && getSideByPosition(status.highestBid.position) === side) {
        throw new Error("Cannot double your own side's contract.");
      }
      if (status.doubled || status.redoubled) {
        throw new Error("Current contract has already been doubled or redoubled.");
      }
      return;
    }

    if (!status.doubled || status.redoubled) {
      throw new Error("Redouble is only valid after a double on the current contract.");
    }

    if (status.highestBid && getSideByPosition(status.highestBid.position) !== side) {
      throw new Error("Only the declaring side may redouble its contract.");
    }
  }

  private shouldEndAuction(): boolean {
    const calls = this.state.bidHistory;
    if (calls.length < 4) {
      return false;
    }

    if (calls.length === 4 && calls.every((call) => call.bid.type === "pass")) {
      return true;
    }

    const lastThree = calls.slice(-3);
    return lastThree.every((call) => call.bid.type === "pass") && this.getAuctionStatus().highestBid !== null;
  }

  private finishAuction(): void {
    const status = this.getAuctionStatus();

    if (!status.highestBid) {
      this.state.phase = "finished";
      this.state.turn = null;
      this.state.contract = null;
      this.state.score = {
        contractResult: "passed-out",
        nsPoints: 0,
        ewPoints: 0,
        winnerSide: "tie",
        playerPoints: {
          [this.state.playersByPosition.N]: 0,
          [this.state.playersByPosition.S]: 0,
          [this.state.playersByPosition.E]: 0,
          [this.state.playersByPosition.W]: 0,
        },
      };
      return;
    }

    const contract = this.buildContract(status);
    this.state.contract = contract;
    this.state.phase = "playing";
    this.state.currentTrick = null;
    this.state.tricks = [];
    this.state.turn = nextPosition(contract.declarer);
  }

  private getAuctionStatus(): AuctionStatus {
    let highestBid: AuctionStatus["highestBid"] = null;
    let doubled = false;
    let redoubled = false;

    for (const call of this.state.bidHistory) {
      if (call.bid.type === "bid" && call.bid.level && call.bid.strain) {
        highestBid = {
          ...call,
          bid: {
            type: "bid",
            level: call.bid.level,
            strain: call.bid.strain,
          },
        };
        doubled = false;
        redoubled = false;
        continue;
      }

      if (call.bid.type === "double") {
        doubled = true;
        redoubled = false;
        continue;
      }

      if (call.bid.type === "redouble") {
        redoubled = true;
      }
    }

    return {
      highestBid,
      doubled,
      redoubled,
    };
  }

  private buildContract(status: AuctionStatus): Contract {
    if (!status.highestBid) {
      throw new Error("Cannot build contract without a winning bid.");
    }

    const side = getSideByPosition(status.highestBid.position);
    const declarer = this.findDeclarer(side, status.highestBid.bid.strain);

    return {
      level: status.highestBid.bid.level,
      strain: status.highestBid.bid.strain,
      declarer,
      side,
      doubled: status.doubled,
      redoubled: status.redoubled,
      isGameContract: isGameContract(status.highestBid.bid.level, status.highestBid.bid.strain),
    };
  }

  private findDeclarer(side: Side, strain: Strain): PlayerPosition {
    for (const call of this.state.bidHistory) {
      if (call.bid.type !== "bid" || call.bid.strain !== strain) {
        continue;
      }

      if (getSideByPosition(call.position) === side) {
        return call.position;
      }
    }

    throw new Error("Cannot determine declarer.");
  }
}