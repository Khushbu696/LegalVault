export const MAX_AGENT_ROUNDS = 5;
export const MAX_TOOL_CALLS_PER_ROUND = 3;

export interface AgentToolCall {
  callId: string;
  name: string;
  arguments: string;
}

export interface AgentToolOutput {
  callId: string;
  output: string;
}

export async function runAgentToolLoop<Response>(options: {
  initialResponse: Response;
  getToolCalls: (response: Response) => AgentToolCall[];
  executeTool: (call: AgentToolCall) => Promise<string>;
  continueWithToolOutputs: (response: Response, outputs: AgentToolOutput[], allowTools: boolean) => Promise<Response>;
  maxRounds?: number;
  maxCallsPerRound?: number;
}): Promise<{ response: Response; rounds: number; limitReached: boolean }> {
  const maxRounds = options.maxRounds ?? MAX_AGENT_ROUNDS;
  const maxCallsPerRound = options.maxCallsPerRound ?? MAX_TOOL_CALLS_PER_ROUND;
  let response = options.initialResponse;
  let rounds = 0;

  while (true) {
    const calls = options.getToolCalls(response);
    if (calls.length === 0) return { response, rounds, limitReached: false };

    if (rounds >= maxRounds) {
      const denied = calls.map((call) => ({
        callId: call.callId,
        output: JSON.stringify({ error: true, message: `Maximum of ${maxRounds} research rounds reached. Answer using evidence collected so far.` }),
      }));
      response = await options.continueWithToolOutputs(response, denied, false);
      return { response, rounds, limitReached: true };
    }

    rounds += 1;
    const outputs = await Promise.all(calls.map(async (call, index) => {
      if (index >= maxCallsPerRound) {
        return {
          callId: call.callId,
          output: JSON.stringify({ error: true, message: `At most ${maxCallsPerRound} tool calls are allowed per research round.` }),
        };
      }
      try {
        return { callId: call.callId, output: await options.executeTool(call) };
      } catch {
        return { callId: call.callId, output: JSON.stringify({ error: true, message: "The document tool failed safely. Try a different query or answer from evidence already collected." }) };
      }
    }));
    response = await options.continueWithToolOutputs(response, outputs, true);
  }
}