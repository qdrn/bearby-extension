import type { MassaControl } from "background/provider";

import { WORKER_POOLING } from "config/common";
import { BrowserStorage, buildObject } from "lib/storage";
import { Fields } from "config/fields";
import  { TransactionsController, HASH_OUT_OF_STORAGE } from "background/transactions";
import { NotificationController } from "lib/runtime/notifications";


enum Statuses {
  Confirmed = 'Confirmed',
  ExpirePeriod = 'Expire period'
}

export class WorkerController {
  readonly #massa: MassaControl;
  readonly #transactions: TransactionsController;

  #delay = WORKER_POOLING;
  #period = 0;

  get period() {
    return this.#period;
  }

  get delay() {
    return this.#delay;
  }

  constructor(
    massa: MassaControl,
    transactions: TransactionsController
  ) {
    this.#transactions = transactions;
    this.#massa = massa;
  }

  subscribe() {
    this.trackBlockNumber();
    const intervalId = globalThis.setInterval(() => {
      this.trackBlockNumber();
    }, this.delay);

    return {
      unsubscribe() {
        globalThis.clearInterval(intervalId);
      }
    }
  }

  async trackBlockNumber() {
    const lastPeriod = this.#period;
    const [{ result, error }] = await this.#massa.getNodesStatus();

    if (error || !result) {
      console.error(JSON.stringify(error, null, 4));
      return;
    }

    if (!result.last_slot) {
      return;
    }

    const newPeriod = Number(result.last_slot.period);

    if (newPeriod <= lastPeriod) {
      return;
    }

    await this.#setPeriod(newPeriod);
    await this.#trackTransactions();
  }

  async #trackTransactions() {
    const list =  this.#transactions.history;
    const now = new Date().getTime();
    const dilaySeconds = 3000;
    const identities = list.filter((t) => {
      return !t.confirmed && (now - t.timestamp) > dilaySeconds;
    });

    if (identities.length === 0) {
      return null;
    }

    const hashSet = identities.map((t) => t.hash);
    const replies = await this.#massa.getOperations(...hashSet);

    for (let index = 0; index < replies.length; index++) {
      const { error, result } = replies[index];
      const indicator = identities[index];
      const listIndex = list.findIndex((t) => t.hash === indicator.hash);

      if (error) {
        list[listIndex].confirmed = true;
        list[listIndex].error = error.message;
        list[listIndex].success = false;
        this.#makeNotify(
          String(list[listIndex].title),
          list[listIndex].hash,
          error.message
        );
        continue;
      }

      if (!result || result.length === 0) {
        list[listIndex].confirmed = true;
        list[listIndex].error = HASH_OUT_OF_STORAGE;
        list[listIndex].success = false;
        this.#makeNotify(
          String(list[listIndex].title),
          list[listIndex].hash,
          HASH_OUT_OF_STORAGE
        );
        continue;
      }

      const [transaction] = result;
      const expirePeriod = transaction.operation.content.expire_period;

      if (!transaction.is_final && expirePeriod < this.period) {
        list[listIndex].confirmed = true;
        list[listIndex].success = false;
        list[listIndex].error = Statuses.ExpirePeriod;

        this.#makeNotify(
          String(list[listIndex].title),
          list[listIndex].hash,
          Statuses.ExpirePeriod
        );

        continue;
      }

      list[listIndex].confirmed = transaction.is_final;
      list[listIndex].success = transaction.is_final;

      if (list[listIndex].confirmed) {
        this.#makeNotify(
          String(list[listIndex].title),
          list[listIndex].hash,
          Statuses.Confirmed
        );
      }
    }

    await this.#transactions.updateHistory(list);
  }

  async sync() {
    // TODO: enable only when mainnet will launch.
    // const content = await BrowserStorage.get(Fields.PERIOD);
    // const block = Number(content);

    // if (isNaN(block)) {
    //   await BrowserStorage.set(
    //     buildObject(Fields.PERIOD, String(this.#period))
    //   );

    //   return;
    // }

    // this.#period = block;
  }

  async #setPeriod(block: number) {
    this.#period = block;

    await BrowserStorage.set(
      buildObject(Fields.PERIOD, String(this.#period))
    );
  }

  #makeNotify(title: string, hash: string, message: string) {
    const url = hash;
    new NotificationController(
      url,
      title,
      message
    ).create();
  }
}
