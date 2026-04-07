/**
 * Dedicated WebWorker layer for heavy matrix computing (e.g. Monte Carlo loops).
 * Offloads massive arrays strictly from the primary thread to guarantee 60fps UX.
 */

self.onmessage = async (event) => {
    const { action, payload } = event.data;

    try {
        if (action === "RUN_MONTE_CARLO") {
            const { simulations, currentPrice, drift, vol, days } = payload;
            
            // Standard simulated Brownian motion loop inside isolated thread
            const finalPrices = new Float32Array(simulations);
            
            for (let i = 0; i < simulations; i++) {
                let p = currentPrice;
                for (let d = 0; d < days; d++) {
                    const shock = Math.random() * 2 - 1; // simplistic normalized dist
                    p *= Math.exp(drift + vol * shock);
                }
                finalPrices[i] = p;
            }

            finalPrices.sort();
            const p5 = finalPrices[Math.floor(simulations * 0.05)];
            const p50 = finalPrices[Math.floor(simulations * 0.50)];
            const p95 = finalPrices[Math.floor(simulations * 0.95)];

            // Return strictly aggregated Recharts visual arrays—never ship millions of numbers over the boundary.
            self.postMessage({
                status: "success",
                data: [
                    { name: "Bear (5%)", target: p5 },
                    { name: "Base (50%)", target: p50 },
                    { name: "Bull (95%)", target: p95 }
                ]
            });
        }
    } catch (error) {
         self.postMessage({ status: "error", message: String(error) });
    }
};
