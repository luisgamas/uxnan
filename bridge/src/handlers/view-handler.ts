import {
  JsonRpcErrorCode,
  RpcError,
  isViewId,
  type ViewReadParams,
  type ViewReadResult,
} from '@uxnan/shared';
import type { HandlerRouter } from '../handler-router.js';
import type { BridgeContext } from '../bridge-context.js';

export function registerViewHandlers(router: HandlerRouter): void {
  router.register('view/read', async (params, ctx: BridgeContext): Promise<ViewReadResult> => {
    const p = params as Partial<ViewReadParams>;
    if (!isViewId(p?.viewId))
      throw RpcError.invalidParams('viewId must be 32 lowercase hexadecimal characters');
    const view = await ctx.viewStore.read(p.viewId);
    if (!view)
      throw new RpcError(JsonRpcErrorCode.ResourceNotFound, `View ${p.viewId} was not found`);
    return view;
  });
}
