"use strict";

const MAX_USER_TEXT_LENGTH = 4000;

function hasOversizedText(fields = {}, maxLength = MAX_USER_TEXT_LENGTH) {
  return Object.values(fields).some((value) => typeof value === "string" && value.length > maxLength);
}

function isTextLengthValid(value, maxLength = MAX_USER_TEXT_LENGTH) {
  return typeof value === "string" && value.length <= maxLength;
}

module.exports = {
  MAX_USER_TEXT_LENGTH,
  hasOversizedText,
  isTextLengthValid,
};
