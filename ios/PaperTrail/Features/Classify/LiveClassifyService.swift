// Owner: classify.
//
// The live ClassifyService: the `classify` 2nd gen callable in us-central1 (functions/lib.js), the
// same function the web app calls. One call per document; the reading queue decides how many run at
// once and which failures to retry. Every failure comes out as a ClassifyFailure with a
// ClassifyErrorCode, read from the function's details.code first and the callable's own error code
// second (the same order as the web app's readError()).
import FirebaseAuth
import FirebaseFunctions
import Foundation

final class LiveClassifyService: ClassifyService {
    /// The web app waits five minutes too; the function's own limit is 300 s.
    static let timeout: TimeInterval = 300

    func classify(_ request: ClassifyRequest) async throws -> ClassifyResponse {
        guard Auth.auth().currentUser != nil else {
            throw ClassifyFailure(code: .signedOut, message: "Not signed in.")
        }
        var callable = Functions.functions(region: "us-central1")
            .httpsCallable("classify", requestAs: ClassifyRequest.self, responseAs: ClassifyResponse.self)
        callable.timeoutInterval = Self.timeout
        do {
            return try await callable.call(request)
        } catch {
            throw Self.failure(from: error)
        }
    }

    /// Stack mode (#19): the same callable with `mode: "split"`. A function deployed before split
    /// mode refuses the request as `bad_request` (it has no `kind`), which the review treats like
    /// any other failed split: the stack stays one document and the scissors still work.
    func proposeSplit(_ request: SplitRequest) async throws -> [SplitDocument] {
        guard Auth.auth().currentUser != nil else {
            throw ClassifyFailure(code: .signedOut, message: "Not signed in.")
        }
        var callable = Functions.functions(region: "us-central1")
            .httpsCallable("classify", requestAs: SplitRequest.self, responseAs: SplitResponse.self)
        callable.timeoutInterval = Self.timeout
        do {
            return try await callable.call(request).split.documents
        } catch {
            throw Self.failure(from: error)
        }
    }

    /// Maps whatever the SDK threw to a ClassifyFailure.
    nonisolated static func failure(from error: any Error) -> ClassifyFailure {
        if let failure = error as? ClassifyFailure { return failure }
        let ns = error as NSError
        if ns.domain == FunctionsErrorDomain {
            let details = ns.userInfo[FunctionsErrorDetailsKey]
            let code = FunctionsErrorCode(rawValue: ns.code)
            return failure(detailsCode: (details as? [String: Any])?["code"] as? String,
                           callableCode: code, message: ns.localizedDescription)
        }
        if ns.domain == NSURLErrorDomain {
            let code: ClassifyErrorCode = ns.code == NSURLErrorTimedOut ? .timeout : .unknown
            return ClassifyFailure(code: code, message: ns.localizedDescription)
        }
        if error is DecodingError {
            return ClassifyFailure(code: .invalidJSON, message: "The reply didn't match the card.")
        }
        return ClassifyFailure(code: .unknown, message: ns.localizedDescription)
    }

    /// details.code wins; otherwise the callable's status says roughly what happened.
    nonisolated static func failure(detailsCode: String?, callableCode: FunctionsErrorCode?, message: String) -> ClassifyFailure {
        if let raw = detailsCode, let code = ClassifyErrorCode(rawValue: raw) {
            return ClassifyFailure(code: code, message: message)
        }
        let code: ClassifyErrorCode = switch callableCode {
        case .unauthenticated: .signedOut
        case .permissionDenied: .notAllowed
        case .deadlineExceeded: .timeout
        case .resourceExhausted: .rateLimited
        case .unavailable: .overloaded
        case .invalidArgument: .badRequest
        default: .unknown
        }
        return ClassifyFailure(code: code, message: message)
    }
}
