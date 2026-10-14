// Owner: classify. Logic only.
//
// What the app says when a read fails. The function sends a short code (ClassifyErrorCode); the
// app picks the words. The card title and the default line are the design spec's (3.1, 3.12).
// Voice: no em dashes, no exclamation points, US spelling.
import Foundation

nonisolated enum ClassifyCopy {
    /// The failed card's title.
    static let failedTitle = "Couldn't read this one"

    /// The failed card's meta line for a code.
    static func message(for code: ClassifyErrorCode) -> String {
        switch code {
        case .signedOut: "Your sign-in expired. Sign in again, then tap Try again."
        case .notAllowed: "This account isn't on the list."
        case .tooLarge: "This one is too big to send to Claude. Your scan is saved."
        case .badRequest: "Claude couldn't open this file. Your scan is saved."
        case .apiKey: "Claude isn't set up yet. Your scan is saved."
        case .refused: "Claude declined to read this one. Your scan is saved."
        case .rateLimited, .timeout, .overloaded, .invalidJSON, .unknown: "Claude didn't answer. Your scan is saved."
        }
    }

    /// Whether "Try again" can help without the user changing anything first.
    static func offersTryAgain(_ code: ClassifyErrorCode) -> Bool {
        switch code {
        case .notAllowed, .tooLarge, .badRequest: false
        default: true
        }
    }
}
