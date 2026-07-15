export function isAcceptedSaveResponse(response) {
  return !!(
    response
    && response.ok
    && !response.skipped
    && !response.syncDisabled
  );
}

export function isNewImportedSaveResponse(response) {
  return isAcceptedSaveResponse(response)
    && !response.duplicate
    && !response.dismissed;
}
