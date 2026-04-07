/**
 * Custom API hooks for endpoints not yet in the auto-generated api.ts.
 * These will be replaced by orval-generated hooks once the OpenAPI spec is regenerated.
 */
import { useMutation, useQuery } from "@tanstack/react-query";
import type { UseMutationOptions, UseMutationResult, UseQueryOptions, UseQueryResult } from "@tanstack/react-query";
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

// ---------------------------------------------------------------------------
// Validation (dry-run) history
// ---------------------------------------------------------------------------

export interface ValidationRunSummaryOut {
  run_id: string;
  source_table_fqn: string;
  status: string | null;
  requesting_user: string | null;
  sample_size: number | null;
  total_rows: number | null;
  valid_rows: number | null;
  invalid_rows: number | null;
  created_at: string | null;
}

export const listValidationRuns = (
  options?: AxiosRequestConfig,
): Promise<AxiosResponse<ValidationRunSummaryOut[]>> => {
  return axios.default.get(`/api/v1/dryrun/runs`, options);
};

export const getListValidationRunsQueryKey = () =>
  [`/api/v1/dryrun/runs`] as const;

export const useListValidationRuns = <
  TData = Awaited<ReturnType<typeof listValidationRuns>>,
  TError = AxiosError<unknown>,
>(
  options?: {
    query?: Partial<UseQueryOptions<Awaited<ReturnType<typeof listValidationRuns>>, TError, TData>>;
    axios?: AxiosRequestConfig;
  },
): UseQueryResult<TData, TError> => {
  const { query: queryOptions, axios: axiosOptions } = options ?? {};
  const queryKey = queryOptions?.queryKey ?? getListValidationRunsQueryKey();

  const queryFn = () => listValidationRuns(axiosOptions);

  return useQuery({ queryKey, queryFn, ...queryOptions }) as UseQueryResult<TData, TError>;
};
