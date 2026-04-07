/**
 * Custom API hooks for endpoints not yet in the auto-generated api.ts.
 * These will be replaced by orval-generated hooks once the OpenAPI spec is regenerated.
 */
import { useMutation } from "@tanstack/react-query";
import type { UseMutationOptions, UseMutationResult } from "@tanstack/react-query";
import * as axios from "axios";
import type { AxiosError, AxiosRequestConfig, AxiosResponse } from "axios";
import type { RuleCatalogEntryOut } from "./api";

export interface BatchSaveRulesIn {
  table_fqns: string[];
  checks: Array<{ [key: string]: unknown }>;
}

export interface BatchSaveRulesOut {
  saved: RuleCatalogEntryOut[];
  failed: Array<{ table_fqn: string; error: string }>;
}

export const batchSaveRules = (
  body: BatchSaveRulesIn,
  options?: AxiosRequestConfig,
): Promise<AxiosResponse<BatchSaveRulesOut>> => {
  return axios.default.post(`/api/v1/rules/batch`, body, options);
};

export const useBatchSaveRules = <
  TError = AxiosError<unknown>,
  TContext = unknown,
>(
  options?: {
    mutation?: UseMutationOptions<
      Awaited<ReturnType<typeof batchSaveRules>>,
      TError,
      { data: BatchSaveRulesIn },
      TContext
    >;
    axios?: AxiosRequestConfig;
  },
): UseMutationResult<
  Awaited<ReturnType<typeof batchSaveRules>>,
  TError,
  { data: BatchSaveRulesIn },
  TContext
> => {
  const { mutation: mutationOptions, axios: axiosOptions } = options ?? {};

  const mutationFn = (props: { data: BatchSaveRulesIn }) => {
    return batchSaveRules(props.data, axiosOptions);
  };

  return useMutation({ mutationFn, mutationKey: ["batchSaveRules"], ...mutationOptions });
};
