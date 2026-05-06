import { Market } from "../types";
import { GLOBAL_TX_PROCESS, TxProcess } from "../constant";

declare module "./index" {
    interface Trade {
        shareInUsd(): number;
        totalValue(): number;
        displayBalance(): void;
        updatePrices(
            remaining_time: number,
            up_buy_price: number,
            up_sell_price: number,
            down_buy_price: number,
            down_sell_price: number
        ): void;
        trending(): Market;
    }
}

// Function to attach methods to Trade class (called from index.ts)
export function attachPricesMethods(TradeClass: new (...args: any[]) => any) {
    const toFiniteNumber = (value: unknown): number => {
        const parsed = typeof value === "number" ? value : Number(value);
        return Number.isFinite(parsed) ? parsed : 0;
    };
    const trendLabel = (trend: Market): string => {
        if (trend === Market.Up) return "🟢";
        if (trend === Market.Down) return "🔴";
        return "⚪";
    };
    const trendName = (trend: Market): string => {
        if (trend === Market.Up) return "UP";
        if (trend === Market.Down) return "DOWN";
        return "FLAT";
    };
    const positionLabel = (position: Market): string => {
        if (position === Market.Up) return "🟩";
        if (position === Market.Down) return "🟥";
        return "⬛";
    };
    const positionName = (position: Market): string => {
        if (position === Market.Up) return "UP";
        if (position === Market.Down) return "DOWN";
        return "NONE";
    };

    TradeClass.prototype.shareInUsd = function (): number {
        if (this.holdingStatus === Market.Up) {
            return this.share * this.upSellPrice;
        }
        if (this.holdingStatus === Market.Down) {
            return this.share * this.downSellPrice;
        }
        return 0;
    };

    TradeClass.prototype.totalValue = function (): number {
        return this.usd + this.shareInUsd();
    };

    TradeClass.prototype.displayBalance = function (): void {
        const shareValue = this.shareInUsd();
        const totalValue = this.totalValue();

        const holdingStatus = `${positionName(this.holdingStatus)} ${positionLabel(this.holdingStatus)}`;
        const trendValue = this.trending();
        const trend = `${trendName(trendValue)} ${trendLabel(trendValue)}`;

        console.log(
            `Portfolio | cash=$${this.usd.toFixed(2)} | shares=${this.share.toFixed(2)} | position=${holdingStatus} | shareValue=$${shareValue.toFixed(2)} | total=$${totalValue.toFixed(2)} | engine=${GLOBAL_TX_PROCESS.current === TxProcess.Working ? "BUSY" : "IDLE"} | trend=${trend}`
        );
    };

    TradeClass.prototype.updatePrices = function (
        remaining_time: number,
        up_buy_price: number,
        up_sell_price: number,
        down_buy_price: number,
        down_sell_price: number
    ): void {
        const upBuyPrice = toFiniteNumber(up_buy_price);
        const upSellPrice = toFiniteNumber(up_sell_price);
        const downBuyPrice = toFiniteNumber(down_buy_price);
        const downSellPrice = toFiniteNumber(down_sell_price);

        const remainingTimeRatio =
            (this.marketTime - remaining_time) / this.marketTime;

        const upPriceRatio = Math.abs(upBuyPrice - 0.5) / 0.5;

        if (this.upBuyPrice !== this.prevUpBuyPrice[1]) {
            this.prevUpBuyPrice = [
                this.prevUpBuyPrice[1],
                this.upBuyPrice,
            ];
        }

        if (this.downBuyPrice !== this.prevDownBuyPrice[1]) {
            this.prevDownBuyPrice = [
                this.prevDownBuyPrice[1],
                this.downBuyPrice,
            ];
        }

        this.upBuyPrice = upBuyPrice;
        this.upSellPrice = upSellPrice;
        this.downBuyPrice = downBuyPrice;
        this.downSellPrice = downSellPrice;

        this.remainingTime = remaining_time;

        const now = Date.now();
        if (now - this.lastStatusLogAt >= 3000) {
            const upSpread = this.upSellPrice - this.upBuyPrice;
            const downSpread = this.downSellPrice - this.downBuyPrice;
            const signalScore = remainingTimeRatio * upPriceRatio;
            const currentTrend = this.trending();
            const trend = `${trendName(currentTrend)} ${trendLabel(currentTrend)}`;
            const position = `${positionName(this.holdingStatus)} ${positionLabel(this.holdingStatus)}`;

            console.log(
                `Market | tMinus=${remaining_time}s/${this.marketTime}s | up=${this.upBuyPrice.toFixed(2)}/${this.upSellPrice.toFixed(2)} spread=${upSpread.toFixed(2)} | down=${this.downBuyPrice.toFixed(2)}/${this.downSellPrice.toFixed(2)} spread=${downSpread.toFixed(2)} | upRatio=${upPriceRatio.toFixed(2)} | timeRatio=${remainingTimeRatio.toFixed(2)} | score=${signalScore.toFixed(2)} | trend=${trend} | position=${position} | engine=${GLOBAL_TX_PROCESS.current === TxProcess.Working ? "BUSY" : "IDLE"}`
            );
            this.displayBalance();
            this.lastStatusLogAt = now;
        }
    };

    TradeClass.prototype.trending = function (): Market {
        const threshold =
            Math.abs(0.5 - this.upBuyPrice) > 0.35 ? 0.02 : 0.03;

        const p0 =
            Math.floor(this.prevUpBuyPrice[0] / threshold) * threshold;
        const p1 =
            Math.floor(this.prevUpBuyPrice[1] / threshold) * threshold;
        const p =
            Math.floor(this.upBuyPrice / threshold) * threshold;

        if (Math.max(p0, p1) < p) return Market.Up;
        if (Math.min(p0, p1) > p) return Market.Down;
        return Market.None;
    };
}