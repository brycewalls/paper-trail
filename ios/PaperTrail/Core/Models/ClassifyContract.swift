// Owner: scaffold (shared contract). The classify agent may add optional fields; never remove or
// rename one, because the live web app sends and reads the same shapes.
//
// Request and response of the `classify` 2nd gen callable (us-central1), see functions/lib.js
// validate() and classify(). Everything marked "new" is optional on both sides, so old clients
// and the old function keep working.
import Foundation

nonisolated struct ClassifyImage: Codable, Sendable, Hashable {
    /// "image/jpeg", "image/png" or "image/webp".
    var type: String
    /// Base64, no data: prefix.
    var data: String
}

nonisolated struct ClassifyRequest: Codable, Sendable, Hashable {
    enum Kind: String, Codable, Sendable { case pdf, images }

    var kind: Kind
    /// Base64 PDF when kind == .pdf (up to 10 pages and about 9 MB, same rule as the web app).
    var pdf: String?
    /// Up to 10 page images when kind == .images (1568 px on the long side).
    var images: [ClassifyImage]?
    var totalPages: Int

    // New, optional.
    /// On-device OCR text (Vision), first ~20,000 characters. Helps Claude and feeds search (#22).
    var ocrText: String?
    /// Sender rules that may apply, so Claude follows earlier corrections (#21).
    var senderHints: [SenderRule]?
    /// Ask for per-field confidence (#20).
    var wantConfidence: Bool?
    /// New (#75): `ocrText` is the main source and `images` is only a downscaled first page. A
    /// function deployed before #75 ignores it and still reads the picture plus the text hint.
    var ocrPrimary: Bool? = nil
}

nonisolated struct ClassifyResponse: Codable, Sendable, Hashable {
    var result: DocumentCard
    var model: String
}

/// The short code the function puts in HttpsError details.code. The app picks its own copy per code.
nonisolated enum ClassifyErrorCode: String, Codable, Sendable, CaseIterable {
    case signedOut = "signed_out"
    case notAllowed = "not_allowed"
    case badRequest = "bad_request"
    case tooLarge = "too_large"
    case apiKey = "api_key"
    case rateLimited = "rate_limited"
    case timeout
    case overloaded
    case refused
    case invalidJSON = "invalid_json"
    case unknown

    /// Worth an automatic retry with backoff.
    var isRetryable: Bool {
        switch self {
        case .rateLimited, .timeout, .overloaded, .invalidJSON, .unknown: true
        default: false
        }
    }
}

nonisolated struct ClassifyFailure: Error, Sendable, Hashable {
    var code: ClassifyErrorCode
    var message: String
}

// MARK: - Split mode (#19, stack mode)

/// One page of a scanned pile for a split request: its on-device OCR text and, optionally, a small
/// thumbnail so Claude can see letterheads and layout.
nonisolated struct SplitPage: Codable, Sendable, Hashable {
    var text: String
    var image: ClassifyImage?
}

/// The classify callable in split mode: `mode` is always "split". The function answers with where
/// each document starts instead of a card. An older function refuses it as `bad_request`.
nonisolated struct SplitRequest: Codable, Sendable, Hashable {
    var mode: String = "split"
    var pages: [SplitPage]

    init(pages: [SplitPage]) { self.pages = pages }
}

/// One proposed document: 0-based, inclusive page range in scan order, and a short label
/// ("Duke Energy bill, March 2024").
nonisolated struct SplitDocument: Codable, Sendable, Hashable {
    var start: Int
    var end: Int
    var label: String
}

nonisolated struct SplitResponse: Codable, Sendable, Hashable {
    nonisolated struct Split: Codable, Sendable, Hashable {
        var documents: [SplitDocument]
    }

    var split: Split
    var model: String
}
