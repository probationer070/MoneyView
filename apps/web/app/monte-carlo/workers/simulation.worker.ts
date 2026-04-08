/// <reference lib="webworker" />

import { runSharedMonteCarloSimulation } from "../lib/simulation-core";
import { runValuationMonteCarlo } from "../lib/valuation-core";
import { runCorrelationMonteCarlo } from "../lib/correlation-core";
import type {
  SimulationWorkerMessage,
  SimulationWorkerResponse,
} from "../lib/types";

const cancelledRequests = new Set<string>();

self.onmessage = (event: MessageEvent<SimulationWorkerMessage>) => {
  const message = event.data;
  if (message.type === "cancel") {
    cancelledRequests.add(message.requestId);
    return;
  }

  cancelledRequests.delete(message.requestId);
  try {
    if (message.type === "run-path") {
      const result = runSharedMonteCarloSimulation(
        message.payload,
        (progress) => {
          const response: SimulationWorkerResponse = {
            type: "progress",
            requestId: message.requestId,
            progress,
          };
          self.postMessage(response);
        },
        () => cancelledRequests.has(message.requestId),
      );
      if (cancelledRequests.has(message.requestId)) {
        cancelledRequests.delete(message.requestId);
        return;
      }
      const response: SimulationWorkerResponse = {
        type: "result",
        requestId: message.requestId,
        result,
      };
      self.postMessage(response);
      return;
    }
    if (message.type === "run-valuation") {
      const result = runValuationMonteCarlo(
        message.payload,
        (progress) => {
          const response: SimulationWorkerResponse = {
            type: "progress",
            requestId: message.requestId,
            progress,
          };
          self.postMessage(response);
        },
        () => cancelledRequests.has(message.requestId),
      );
      if (cancelledRequests.has(message.requestId)) {
        cancelledRequests.delete(message.requestId);
        return;
      }
      const response: SimulationWorkerResponse = {
        type: "valuation-result",
        requestId: message.requestId,
        result,
      };
      self.postMessage(response);
      return;
    }
    const response: SimulationWorkerResponse = {
      type: "correlation-result",
      requestId: message.requestId,
      result: runCorrelationMonteCarlo(
        message.payload,
        (progress) => {
          const progressResponse: SimulationWorkerResponse = {
            type: "progress",
            requestId: message.requestId,
            progress,
          };
          self.postMessage(progressResponse);
        },
        () => cancelledRequests.has(message.requestId),
      ),
    };
    self.postMessage(response);
  } catch (error) {
    if (cancelledRequests.has(message.requestId)) {
      cancelledRequests.delete(message.requestId);
      return;
    }
    const response: SimulationWorkerResponse = {
      type: "error",
      requestId: message.requestId,
      error: error instanceof Error ? error.message : "Unknown worker error",
    };
    self.postMessage(response);
  }
};

export {};
