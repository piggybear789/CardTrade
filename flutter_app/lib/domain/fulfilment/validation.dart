/// Fulfilment Validation — client-side validation for fulfilment terms.
///
/// Mirrors `domain/fulfilment/` in the web app.
///
/// Rules:
/// - Meeting places MUST be provider-resolved (from Places API)
/// - Meeting time must be in the future
/// - Delivery cost is integer cents, 0 = free, null = not yet agreed
/// - Method is nullable during early negotiation
library;
import '../../models/enums.dart';

/// Inspection window constants.
const int tradeInspectionHours = 72;
const int tradeInspectionFloorHours = 24;
const int cashSaleInspectionDays = 7;

/// Maximum delivery cost in cents.
const int deliveryCostMaxCents = 99999999999;

/// A resolved place from Google Places API.
class ResolvedPlace {
  const ResolvedPlace({
    required this.label,
    required this.placeId,
    required this.lat,
    required this.lng,
    this.countryCode,
  });

  final String label;
  final String placeId;
  final double lat;
  final double lng;
  final String? countryCode;

  /// Whether this place is truly resolved (has API-backed coordinates).
  bool get isResolved => placeId.isNotEmpty && lat != 0 && lng != 0;
}

/// Fulfilment terms for a contract.
class FulfilmentTerms {
  const FulfilmentTerms({
    this.method,
    this.meetingPlace,
    this.meetingAt,
    this.deliveryCostCents,
    this.deliveryNotes,
  });

  final HandoverMethod? method;
  final ResolvedPlace? meetingPlace;
  final DateTime? meetingAt;
  final int? deliveryCostCents;
  final String? deliveryNotes;
}

/// Validation error types for fulfilment terms.
enum FulfilmentError {
  methodRequired,
  meetingPlaceRequired,
  meetingPlaceUnresolved,
  meetingTimeRequired,
  meetingTimePast,
  deliveryCostRequired,
  deliveryCostInvalid,
}

/// Result of validating fulfilment terms.
sealed class FulfilmentValidation {
  const FulfilmentValidation();
}

class FulfilmentValid extends FulfilmentValidation {
  const FulfilmentValid();
}

class FulfilmentInvalid extends FulfilmentValidation {
  const FulfilmentInvalid(this.error);
  final FulfilmentError error;
}

/// Validates fulfilment terms for completeness.
///
/// Returns [FulfilmentValid] if all required fields are present and valid,
/// or [FulfilmentInvalid] with the first error found.
FulfilmentValidation validateFulfilmentTerms(FulfilmentTerms terms) {
  // Method is required at the commitment point
  if (terms.method == null) {
    return const FulfilmentInvalid(FulfilmentError.methodRequired);
  }

  if (terms.method == HandoverMethod.inPerson) {
    // Meeting place must be provided
    if (terms.meetingPlace == null) {
      return const FulfilmentInvalid(FulfilmentError.meetingPlaceRequired);
    }
    // Meeting place must be resolved via Places API
    if (!terms.meetingPlace!.isResolved) {
      return const FulfilmentInvalid(FulfilmentError.meetingPlaceUnresolved);
    }
    // Meeting time must be provided
    if (terms.meetingAt == null) {
      return const FulfilmentInvalid(FulfilmentError.meetingTimeRequired);
    }
    // Meeting time must be in the future
    if (terms.meetingAt!.isBefore(DateTime.now())) {
      return const FulfilmentInvalid(FulfilmentError.meetingTimePast);
    }
  }

  if (terms.method == HandoverMethod.delivery) {
    // Delivery cost must be specified (0 = free postage)
    if (terms.deliveryCostCents == null) {
      return const FulfilmentInvalid(FulfilmentError.deliveryCostRequired);
    }
    // Delivery cost must be non-negative and within bounds
    if (terms.deliveryCostCents! < 0 ||
        terms.deliveryCostCents! > deliveryCostMaxCents) {
      return const FulfilmentInvalid(FulfilmentError.deliveryCostInvalid);
    }
  }

  return const FulfilmentValid();
}

/// Derives the trade inspection deadline from the LATER carrier delivery time.
///
/// The clock starts from carrier-confirmed delivery (not trader's assertion).
/// For IN_PERSON, the clock starts from the agreed meeting instant.
/// A 24-hour floor ensures a late confirmation still leaves room to dispute.
DateTime? deriveTradeInspectionDeadline({
  required HandoverMethod? method,
  DateTime? initiatorCarrierDeliveredAt,
  DateTime? counterpartCarrierDeliveredAt,
  DateTime? meetingAt,
}) {
  if (method == HandoverMethod.inPerson) {
    if (meetingAt == null) return null;
    return meetingAt.add(const Duration(hours: tradeInspectionHours));
  }

  if (method == HandoverMethod.delivery) {
    // Clock starts from the LATER carrier-confirmed delivery
    if (initiatorCarrierDeliveredAt == null ||
        counterpartCarrierDeliveredAt == null) {
      return null;
    }
    final laterDelivery = initiatorCarrierDeliveredAt
            .isAfter(counterpartCarrierDeliveredAt)
        ? initiatorCarrierDeliveredAt
        : counterpartCarrierDeliveredAt;

    final deadline =
        laterDelivery.add(const Duration(hours: tradeInspectionHours));

    // 24-hour floor from now
    final floor = DateTime.now().add(
      const Duration(hours: tradeInspectionFloorHours),
    );
    return deadline.isAfter(floor) ? deadline : floor;
  }

  return null;
}
