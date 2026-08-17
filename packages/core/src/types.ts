export interface ToolCall {
  tool: string;
  arguments: Record<string, any>;
  context?: Record<string, any>;
}

export interface Decision {
  status: 'allowed' | 'blocked' | 'review' | 'would_block';
  reason?: string;
  policy_matched?: string;
}

export interface Policy {
  id: string;
  tool: string | '*';
  action: 'allow' | 'block' | 'review';
  condition?: 'always' | 'arg_equals' | 'arg_contains';
  value?: any;
}

export interface AuditEntry {
  id: string;
  timestamp: string;
  tool: string;
  arguments_masked: any;
  decision: string;
  reason?: string;
  policy_matched?: string;
  previous_hash: string;
  current_hash: string;
}
